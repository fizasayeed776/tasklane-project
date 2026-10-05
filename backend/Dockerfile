FROM python:3.12-slim
ARG INSTALL_DEV=true
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN if [ "$INSTALL_DEV" = "true" ]; then \
    pip install --no-cache-dir -r requirements-dev.txt; \
    else \
    pip install --no-cache-dir -r requirements.txt; \
    fi
COPY . .
