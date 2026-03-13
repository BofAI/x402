with open("python/x402/src/bankofai/x402/http/middleware/fastapi.py", "r") as f:
    text = f.read()

text = text.replace(
    '''        if result.type == "payment-error":
            # Return 402 response''',
    '''        if result.type == "payment-error":
            print(f"DEBUG PAYMENT ERROR: {result.response.body if result.response else 'No Body'}", flush=True)
            # Return 402 response'''
)

with open("python/x402/src/bankofai/x402/http/middleware/fastapi.py", "w") as f:
    f.write(text)
