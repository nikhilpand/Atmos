FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

WORKDIR /app

# Install curl_cffi build deps (needed for TLS fingerprinting) and libtorrent
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    gcc \
    python3-libtorrent \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Hugging Face Spaces runs on port 7860
EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "2"]
