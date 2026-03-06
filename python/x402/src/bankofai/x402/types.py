"""
Type definitions for x402 protocol
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# Delivery Kind constants
PAYMENT_ONLY = "PAYMENT_ONLY"

DeliveryKind = Literal["PAYMENT_ONLY"]

# Kind mapping for EIP-712 (string to numeric)
KIND_MAP = {
    PAYMENT_ONLY: 0,
}


class PermitMeta(BaseModel):
    """Payment permit metadata"""

    kind: DeliveryKind
    payment_id: str = Field(alias="paymentId")
    nonce: str
    valid_after: int = Field(alias="validAfter")
    valid_before: int = Field(alias="validBefore")

    class Config:
        populate_by_name = True


class Payment(BaseModel):
    """Payment information"""

    pay_token: str = Field(alias="payToken")
    pay_amount: str = Field(alias="payAmount")
    pay_to: str = Field(alias="payTo")

    class Config:
        populate_by_name = True


class Fee(BaseModel):
    """Fee information"""

    fee_to: str = Field(alias="feeTo")
    fee_amount: str = Field(alias="feeAmount")

    class Config:
        populate_by_name = True


class PaymentPermit(BaseModel):
    """Payment permit structure"""

    meta: PermitMeta
    buyer: str
    caller: str
    payment: Payment
    fee: Fee


class FeeInfo(BaseModel):
    """Fee information in payment requirements"""

    facilitator_id: Optional[str] = Field(None, alias="facilitatorId")
    fee_to: str = Field(alias="feeTo")
    fee_amount: str = Field(alias="feeAmount")
    caller: Optional[str] = None

    class Config:
        populate_by_name = True


class PaymentRequirementsExtra(BaseModel):
    """Extra information in payment requirements"""

    name: Optional[str] = None
    version: Optional[str] = None
    fee: Optional[FeeInfo] = None


class PaymentRequirements(BaseModel):
    """Payment requirements from server"""

    scheme: str
    network: str
    amount: str
    asset: str
    pay_to: str = Field(alias="payTo")
    max_timeout_seconds: Optional[int] = Field(None, alias="maxTimeoutSeconds")
    extra: Optional[PaymentRequirementsExtra] = None

    class Config:
        populate_by_name = True


class PaymentPermitContextMeta(BaseModel):
    """Meta information in payment permit context"""

    kind: DeliveryKind
    payment_id: str = Field(alias="paymentId")
    nonce: str
    valid_after: int = Field(alias="validAfter")
    valid_before: int = Field(alias="validBefore")

    class Config:
        populate_by_name = True


class PaymentPermitContext(BaseModel):
    """Payment permit context from extensions"""

    meta: PaymentPermitContextMeta


class ResourceInfo(BaseModel):
    """Resource information"""

    url: Optional[str] = None
    description: Optional[str] = None
    mime_type: Optional[str] = Field(None, alias="mimeType")

    class Config:
        populate_by_name = True


class PaymentRequiredExtensions(BaseModel):
    """Extensions in PaymentRequired"""

    payment_permit_context: Optional[PaymentPermitContext] = Field(
        None, alias="paymentPermitContext"
    )

    class Config:
        populate_by_name = True
        extra = "allow"


class PaymentRequired(BaseModel):
    """Payment required response (402)"""

    x402_version: int = Field(alias="x402Version")
    error: Optional[str] = None
    resource: Optional[ResourceInfo] = None
    accepts: list[PaymentRequirements]
    extensions: Optional[PaymentRequiredExtensions] = None

    class Config:
        populate_by_name = True


class PaymentPayloadData(BaseModel):
    """Payment payload data"""

    signature: str
    merchant_signature: Optional[str] = Field(None, alias="merchantSignature")
    payment_permit: Optional[PaymentPermit] = Field(None, alias="paymentPermit")

    class Config:
        populate_by_name = True


class PaymentPayload(BaseModel):
    """Payment payload sent by client"""

    x402_version: int = Field(alias="x402Version")
    resource: Optional[ResourceInfo] = None
    accepted: PaymentRequirements
    payload: PaymentPayloadData
    extensions: Optional[dict[str, Any]] = None

    class Config:
        populate_by_name = True


class VerifyResponse(BaseModel):
    """Verification response from facilitator"""

    is_valid: bool = Field(alias="isValid")
    invalid_reason: Optional[str] = Field(None, alias="invalidReason")

    class Config:
        populate_by_name = True


class TransactionInfo(BaseModel):
    """Transaction information"""

    hash: str
    block_number: Optional[str] = Field(None, alias="blockNumber")
    status: Optional[str] = None

    class Config:
        populate_by_name = True


class SettleResponse(BaseModel):
    """Settlement response from facilitator"""

    success: bool
    transaction: Optional[str] = None
    network: Optional[str] = None
    error_reason: Optional[str] = Field(None, alias="errorReason")

    class Config:
        populate_by_name = True


class SupportedKind(BaseModel):
    """Supported payment kind"""

    x402_version: int = Field(alias="x402Version")
    scheme: str
    network: str

    class Config:
        populate_by_name = True


class SupportedFee(BaseModel):
    """Supported fee configuration"""

    fee_to: str = Field(alias="feeTo")
    pricing: Literal["per_accept", "flat"]

    class Config:
        populate_by_name = True


class SupportedResponse(BaseModel):
    """Supported response from facilitator"""

    kinds: list[SupportedKind]
    fee: SupportedFee  # Required - facilitator must configure fee with non-empty feeTo

    class Config:
        populate_by_name = True


class FeeQuoteResponse(BaseModel):
    """Fee quote response from facilitator"""

    fee: FeeInfo
    pricing: str
    scheme: str
    network: str
    asset: str
    expires_at: Optional[int] = Field(None, alias="expiresAt")

    class Config:
        populate_by_name = True
