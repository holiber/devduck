# Docker Registry Authentication

## Authentication in registry.yandex.net

To use images from `registry.yandex.net`, you need to authenticate:

### Step 1: Get OAuth Token

1. Go to: https://oauth.yandex-team.ru/authorize?response_type=token&client_id=ff5e570368ff4c80a70c5699edffabcd9
2. Copy the received OAuth token

### Step 2: Authenticate in Docker

```bash
docker login -u $(whoami) registry.yandex.net
# Enter OAuth token as password
```

You should see: `Login Succeeded`

### Verify Authentication

```bash
# Check for credentials
cat ~/.docker/config.json | grep -A 5 "registry.yandex.net"
```

### Using Pre-built Base Image

If you have a pre-built base image with arc/ya tools in the registry:

```bash
# Specify base image via environment variable
export DOCKER_BASE_IMAGE=registry.yandex.net/<your-image>:<tag>
node scripts/docker.js install
```

Or when building the image:

```bash
docker build --build-arg BASE_IMAGE=registry.yandex.net/<your-image>:<tag> -f Dockerfile.plan -t devduck-plan:latest .
```

### Finding Available Images

Try to find a ready-made image with arc/ya:

```bash
# Try standard names
docker pull registry.yandex.net/devtools/base:latest
docker pull registry.yandex.net/tools/base:latest
docker pull registry.yandex.net/arcadia/base:latest
```

### Creating Your Own Base Image with arc/ya

If there is no ready-made image, you can create your own base image with arc/ya tools:

#### Option 1: Build via ya package from Arcadia

1. Create `package.json` in Arcadia with Docker image description
2. Build image: `ya package <package.json> --docker`
3. Push to registry: `docker push <your-registry>/<your-namespace>/<image-name>:latest`
4. Use: `export DOCKER_BASE_IMAGE=<your-registry>/<your-namespace>/<image-name>:latest`

#### Option 2: Fix arc/ya Installation in Current Dockerfile

Problem: repository `http://repo.yandex.ru/arcadia` is unavailable or requires a different installation method.

Possible solutions:
- Use a different repository for arc/ya
- Download arc/ya binaries directly
- Build arc/ya from Arcadia sources (requires access to Arcadia)

### Troubleshooting

**Error: "unauthorized: authentication required"**
- Check authentication: `docker login registry.yandex.net`
- Ensure OAuth token has not expired

**Error: "Error saving credentials"**
- On macOS, you may need `sudo docker login`
- Or configure Docker credential helper

**Image Not Found**
- Check image name is correct
- Ensure you have access rights to the image
- Try other image name variants
