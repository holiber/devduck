# Docker and Arcadia: Setup and Usage

## Overview

This document describes the setup of Docker containers for working with Arcadia, including mounting Arcadia inside containers and using podman recipes for testing.

## Basic Requirements

### 1. FUSE Filesystem

Arcadia uses `arc mount`, which requires FUSE (Filesystem in Userspace). Docker containers need special privileges to use FUSE:

- `--cap-add SYS_ADMIN`: Required for mounting filesystems
- `--device /dev/fuse`: Required for FUSE device access
- `--security-opt apparmor=unconfined`: May be needed for some FUSE operations

### 2. FUSE Configuration in Container

Before mounting Arcadia in the container, you need to configure FUSE:

```bash
# Add user_allow_other to /etc/fuse.conf
echo "user_allow_other" | tee -a /etc/fuse.conf
```

### 3. Mounting Arcadia

**Important condition** for successful execution is mounting Arcadia with the `--allow-other` option, which allows running commands as root user:

```bash
arc mount ~/arcadia --allow-other
```

**Complete setup example in Docker container:**

```bash
# 1. Configure FUSE
echo "user_allow_other" | tee -a /etc/fuse.conf

# 2. Mount Arcadia
arc mount ~/arcadia --allow-other

# 3. Switch to desired branch
cd ~/arcadia
arc pull trunk
arc co trunk

# 4. Navigate to project directory
cd ~/arcadia/junk/alex-nazarov/barducks
```

## Docker Compose and Testing

### Using Podman Recipe

It is recommended to use podman as the engine for Docker containers because it:
- Does not require a constantly running daemon
- Works well on distbuild
- Can be used in MEDIUM/SMALL tests

### Usage Example

```bash
# Run tests using podman recipe
ya test library/recipes/podman_recipe/recipe/podman_compose/examples/medium/example
```

### Using System Podman

To speed up local recipe execution, you can use podman that is already installed in the system:

```bash
USE_SYSTEM_PODMAN=1 ya test <test-path>
```

**Important:** Such execution will differ from autobuild, so if there are discrepancies between runs with system podman and without it, use the standard execution method.

## Linux Environment Setup

### 1. Install Required Packages

```bash
sudo apt-get update
sudo apt-get install -y fuse3 docker.io
```

### 2. Configure FUSE

```bash
echo "user_allow_other" | sudo tee -a /etc/fuse.conf
```

### 3. Docker Registry Authentication

To work with images from `registry.yandex.net`, you need to authenticate:

```bash
# Get OAuth token: https://oauth.yandex-team.ru/authorize?response_type=token&client_id=ff5e570368ff4c80a70c5699edffabcd9
# Save token to environment variable
export DOCKER_TOKEN=<your-oauth-token>

# Login to registry
echo "$DOCKER_TOKEN" | docker login registry.yandex.net -u <your-login> --password-stdin
```

For more details, see [docker-registry-auth.md](./docker-registry-auth.md)

## Using Custom Images

### Creating Custom Dockerfile

1. Create a Dockerfile with required dependencies:

```dockerfile
FROM ubuntu:22.04

# Install FUSE and required tools
RUN apt-get update && apt-get install -y \
    fuse3 \
    ca-certificates \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install arc
RUN apt-get update && \
    apt-get install -y yandex-arc-launcher || \
    echo "Warning: arc installation failed"

# Configure FUSE
RUN echo "user_allow_other" >> /etc/fuse.conf
```

2. Build the image:

```bash
docker build -t my-arcadia-image:latest .
```

3. Login to docker-registry:

```bash
docker login registry.yandex.net
```

4. Push image to registry:

```bash
docker tag my-arcadia-image:latest registry.yandex.net/<namespace>/my-arcadia-image:latest
docker push registry.yandex.net/<namespace>/my-arcadia-image:latest
```

## Example Container Run with Arcadia

```bash
docker run -it \
  --cap-add SYS_ADMIN \
  --device /dev/fuse \
  --security-opt apparmor=unconfined \
  -v $(pwd)/.cache/tasks:/workspace/.cache/tasks \
  my-arcadia-image:latest \
  bash -c "
    echo 'user_allow_other' >> /etc/fuse.conf && \
    arc mount ~/arcadia --allow-other && \
    cd ~/arcadia/junk/alex-nazarov/barducks && \
    node scripts/install.js --yes
  "
```

## Troubleshooting

### Issue: Cannot Mount Arcadia in Docker

**Symptoms:**
- Error `fuse: device not found`
- Error `permission denied`

**Solutions:**

1. Ensure the container is started with required flags:
   ```bash
   --cap-add SYS_ADMIN --device /dev/fuse
   ```

2. Check FUSE configuration:
   ```bash
   cat /etc/fuse.conf | grep user_allow_other
   ```

3. Use `--allow-other` when mounting:
   ```bash
   arc mount ~/arcadia --allow-other
   ```

### Issue: Arc Not Found in Container

**Solutions:**

1. Install `yandex-arc-launcher` in the image:
   ```dockerfile
   RUN apt-get update && apt-get install -y yandex-arc-launcher
   ```

2. Or use a pre-built base image with Arc pre-installed from `registry.yandex.net`

3. Or mount Arc binaries from host (Linux hosts only)

## Additional Resources

- [Podman Recipe Documentation](https://docs.yandex-team.ru/devtools/test/podman_recipe)
- [Docker Compose Example](https://docs.yandex-team.ru/devtools/test/compose_example)
- [Arcadia Docker Setup](https://docs.yandex-team.ru/devtools/test/environment#docker-compose)
- [Arc Mount Reference](https://docs.yandex-team.ru/arc/ref/commands#mount)
