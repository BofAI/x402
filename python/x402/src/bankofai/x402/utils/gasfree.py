import asyncio
import base64
import hmac
import json
import logging
import time
from typing import Any, Dict, List

import httpx

from bankofai.x402.utils.address import tron_address_to_evm

logger = logging.getLogger(__name__)

# GasFree EIP-712 Domain Definition
GASFREE_DOMAIN_TYPE = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

# GasFree TIP-712 Message Types
GASFREE_TYPES = {
    "PermitTransfer": [
        {"name": "token", "type": "address"},
        {"name": "serviceProvider", "type": "address"},
        {"name": "user", "type": "address"},
        {"name": "receiver", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "maxFee", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
        {"name": "version", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
    ],
}


class GasFreeAPIClient:
    def __init__(self, base_url: str, api_key: str | None = None, api_secret: str | None = None):
        from bankofai.x402.config import NetworkConfig

        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

        # If keys are missing, try to infer the network from base_url to fetch env-specific keys
        if not api_key or not api_secret:
            network = "tron:mainnet"
            if "open-test" in base_url:
                if "nile" in base_url:
                    network = "tron:nile"
                elif "shasta" in base_url:
                    network = "tron:shasta"

            self.api_key = api_key or NetworkConfig.get_gasfree_api_key(network)
            self.api_secret = api_secret or NetworkConfig.get_gasfree_api_secret(network)
        else:
            self.api_key = api_key
            self.api_secret = api_secret

    def _generate_signature(self, method: str, path: str, timestamp: int) -> str:
        """Generate HMAC signature for authentication"""
        if not self.api_secret:
            return ""

        message = f"{method}{path}{timestamp}"
        signature_bytes = hmac.new(
            self.api_secret.encode("utf-8"), message.encode("utf-8"), digestmod="sha256"
        ).digest()
        return base64.b64encode(signature_bytes).decode("utf-8")

    def _get_headers(self, method: str, path: str) -> Dict[str, str]:
        """Generate headers with authentication"""
        headers = {"Content-Type": "application/json"}
        if not self.api_key or not self.api_secret:
            return headers

        # Ensure path includes the network prefix if it's not already there
        full_path = path
        base_url_parts = self.base_url.split("/")
        # If base_url is https://open-test.gasfree.io/nile, the prefix is /nile
        prefix = ""
        if len(base_url_parts) > 3:
            prefix = "/" + "/".join(base_url_parts[3:])
            if not full_path.startswith(prefix):
                full_path = prefix + path

        timestamp = int(time.time())
        signature = self._generate_signature(method, full_path, timestamp)

        headers.update(
            {"Timestamp": str(timestamp), "Authorization": f"ApiKey {self.api_key}:{signature}"}
        )
        return headers

    async def get_address_info(self, user: str) -> Dict[str, Any]:
        """Get full account info (activation, balance, nonce) for a user"""
        path = f"/api/v1/address/{user}"
        url = f"{self.base_url}{path}"
        try:
            headers = self._get_headers("GET", path)
            response = await self._client.get(url, headers=headers)
            if response.status_code != 200:
                logger.error(f"GasFree API error {response.status_code}: {response.text}")
                response.raise_for_status()
            result = response.json()
            if result.get("code") != 200:
                err_msg = result.get("message") or result.get("reason")
                raise RuntimeError(f"API business error: {err_msg} - Body: {response.text}")
            data = result.get("data")
            if data is None:
                raise RuntimeError(f"GasFree API returned null data for address {user}")
            return data
        except Exception as e:
            if isinstance(e, httpx.HTTPStatusError):
                logger.error(f"HTTP Status Error Body: {e.response.text}")
            logger.error(f"Failed to get address info from GasFree API from {url}: {e}")
            raise

    async def get_providers(self) -> List[Dict[str, Any]]:
        """Get all supported service providers from configuration"""
        path = "/api/v1/config/provider/all"
        url = f"{self.base_url}{path}"
        try:
            headers = self._get_headers("GET", path)
            response = await self._client.get(url, headers=headers)
            if response.status_code != 200:
                logger.error(f"GasFree API error {response.status_code}: {response.text}")
                response.raise_for_status()
            result = response.json()
            if result.get("code") != 200:
                raise RuntimeError(
                    f"API business error: {result.get('message') or result.get('reason')}"
                )
            data = result.get("data")
            if data is None:
                raise RuntimeError("GasFree config API returned null data")
            return data.get("providers", [])
        except Exception as e:
            logger.error(f"Failed to get providers from GasFree API: {e}")
            raise

    async def get_nonce(self, user: str, token: str, chain_id: int) -> int:
        """Get current recommended nonce for a user"""
        try:
            data = await self.get_address_info(user)
            return data.get("nonce", 0)
        except Exception as e:
            logger.warning(f"Failed to get nonce from GasFree API: {e}. Defaulting to 0.")
            return 0

    async def get_status(self, trace_id: str) -> Dict[str, Any] | None:
        """Get status of a submitted GasFree transaction.

        Returns None if the API returned null data (e.g. status not yet available).
        """
        path = f"/api/v1/gasfree/{trace_id}"
        url = f"{self.base_url}{path}"
        try:
            headers = self._get_headers("GET", path)
            response = await self._client.get(url, headers=headers)
            if response.status_code != 200:
                logger.error(f"GasFree API error {response.status_code}: {response.text}")
                response.raise_for_status()
            result = response.json()
            if result.get("code") != 200:
                raise RuntimeError(
                    f"API business error: {result.get('message') or result.get('reason')}"
                )
            data = result.get("data")
            if data is not None:
                logger.info(f"GasFree Status Response for {trace_id}: {json.dumps(data)}")
            return data
        except Exception as e:
            logger.error(f"Failed to get GasFree transaction status: {e}")
            raise

    async def wait_for_success(
        self,
        trace_id: str,
        timeout: int = 120,
        poll_interval: int = 5,
        max_errors: int = 3,
    ) -> Dict[str, Any]:
        """Wait for a GasFree transaction to reach a terminal state or ON_CHAIN state"""
        start_time = time.time()
        error_count = 0
        logger.info(f"Start polling for GasFree transaction {trace_id} (timeout={timeout}s)...")

        while time.time() - start_time < timeout:
            try:
                status_data = await self.get_status(trace_id)
                error_count = 0  # reset on successful poll
            except Exception as e:
                error_count += 1
                logger.warning(
                    f"GasFree status poll failed for {trace_id}"
                    f" (error #{error_count}): {e}, retrying..."
                )
                if error_count >= max_errors:
                    raise RuntimeError(
                        f"GasFree status polling aborted after {error_count} consecutive errors"
                    ) from e
                await asyncio.sleep(poll_interval)
                continue
            if not status_data:
                logger.debug(f"GasFree transaction {trace_id} status not yet available, waiting...")
                await asyncio.sleep(poll_interval)
                continue
            state = (status_data.get("state") or "").upper()
            txn_state = (status_data.get("txnState") or "").upper()

            logger.info(f"GasFree transaction {trace_id}: state={state}, txnState={txn_state}")

            # 1. Immediate return for successful or "good enough" states
            if state == "SUCCEED" or (
                status_data.get("txnHash") and txn_state in ["ON_CHAIN", "SOLIDITY"]
            ):
                return status_data

            if state == "FAILED" or txn_state == "ON_CHAIN_FAILED":
                raise RuntimeError(
                    f"GasFree transaction failed. Reason: {status_data.get('reason')}"
                )

            await asyncio.sleep(poll_interval)

        raise TimeoutError(
            f"GasFree transaction {trace_id} timed out after {timeout}s"
            f" ({error_count} errors encountered)"
        )

    async def submit(self, domain: Dict[str, Any], message: Dict[str, Any], signature: str) -> str:
        """Submit a signed GasFree transaction to the official relayer"""
        path = "/api/v1/gasfree/submit"
        url = f"{self.base_url}{path}"
        sig = signature[2:] if signature.startswith("0x") else signature
        payload = {
            "token": message["token"],
            "serviceProvider": message["serviceProvider"],
            "user": message["user"],
            "receiver": message["receiver"],
            "value": str(message["value"]),
            "maxFee": str(message["maxFee"]),
            "deadline": int(message["deadline"]),
            "version": 1,
            "nonce": int(message["nonce"]),
            "sig": sig,
            "requestId": f"x402-{int(time.time())}-{sig[:8]}",
        }

        try:
            headers = self._get_headers("POST", path)
            response = await self._client.post(url, json=payload, headers=headers)
            if response.status_code != 200:
                logger.error(f"GasFree API error {response.status_code}: {response.text}")
                response.raise_for_status()
            result = response.json()
            if result.get("code") != 200:
                err_msg = result.get("message") or result.get("reason")
                raise RuntimeError(f"API business error: {err_msg} - Body: {response.text}")
            data = result.get("data")
            if data is None:
                raise RuntimeError("GasFree submit API returned null data")
            trace_id = data.get("id")
            if not trace_id:
                raise RuntimeError("GasFree submit API returned data without 'id' field")
            return trace_id
        except Exception as e:
            if isinstance(e, httpx.HTTPStatusError):
                logger.error(f"HTTP Status Error Body: {e.response.text}")
            logger.error(f"Failed to submit GasFree transaction to {url}: {e}", exc_info=True)
            raise


def get_gasfree_domain(chain_id: int, verifying_contract: str) -> Dict[str, Any]:
    """Get GasFree TIP-712 domain"""
    return {
        "name": "GasFreeController",
        "version": "V1.0.0",
        "chainId": chain_id,
        "verifyingContract": tron_address_to_evm(verifying_contract),
    }
