# Docker Containers with Independent Arcadia Mounts

## Overview

This document describes the Docker configuration for running parallel plan generation in isolated containers, where each container has its own independent Arcadia mount. This allows different branches to be active in different containers simultaneously.

## Key Requirements

### 1. FUSE Filesystem Support

Arcadia uses `arc mount` which requires FUSE (Filesystem in Userspace). Docker containers need special privileges to use FUSE:

- `--cap-add SYS_ADMIN`: Required for mounting filesystems
- `--device /dev/fuse`: Required for FUSE device access
- `--security-opt apparmor=unconfined`: May be needed for some FUSE operations

### 2. Base Image

**Recommended**: `ubuntu:22.04` or similar full Linux distribution

**Why not `node:20-slim`?**
- Slim images lack build tools and FUSE support
- Arcadia build system (ya) requires Python, build-essential, and other tools
- FUSE packages need to be installed

**Current configuration uses `ubuntu:22.04` with:**
- FUSE3 and legacy FUSE support
- Node.js LTS (20.x)
- Build tools (build-essential, python3)
- Git and other essential tools

### 3. Arc and Ya Tools Installation

**Option A: Install in Docker image (Recommended for isolation)**
- Install arc and ya tools during image build
- Requires access to Yandex package repositories
- Better isolation, but larger image size

**Option B: Mount from host (Faster setup)**
- Mount arc/ya binaries from host system
- Requires host to have arc/ya installed
- Faster, but less isolated

**Current approach**: Tools should be installed in the image or mounted from host. The container script checks for `arc` command availability.

### 4. Independent Arcadia Mounts

Each container mounts Arcadia independently:

```bash
# Inside each container
arc mount /arcadia --allow-other
```

**Benefits:**
- Each container can have different branch checked out
- No conflicts between parallel containers
- Full isolation of working directories

**Considerations:**
- Each mount consumes resources
- Network access to Arcadia servers required
- May require VPN or special network configuration

## Docker Configuration

### Dockerfile.plan

```dockerfile
FROM ubuntu:22.04

# Install FUSE, Node.js, build tools
# Install arc and ya tools (or mount from host)

# Each container will mount Arcadia at /arcadia
RUN mkdir -p /arcadia
```

### Container Run Command

```bash
docker run \
  --cap-add SYS_ADMIN \
  --device /dev/fuse \
  --security-opt apparmor=unconfined \
  -e ARCADIA=/arcadia \
  devduck-plan:latest \
  sh -c "arc mount /arcadia --allow-other && ..."
```

## Security Considerations

### Privileges Required

FUSE requires elevated privileges, which increases security risk:

1. **Minimal privileges**: Use `--cap-add SYS_ADMIN` instead of `--privileged`
2. **Read-only mounts**: Mount host directories as read-only when possible
3. **Resource limits**: Set CPU and memory limits
4. **Network isolation**: Use Docker networks to isolate containers

### Best Practices

1. **Don't run as root**: Create non-root user in container (if possible with FUSE)
2. **Limit capabilities**: Only add necessary capabilities
3. **Monitor resources**: Set resource limits per container
4. **Clean up**: Use `--rm` flag to auto-remove containers after completion

## Troubleshooting

### FUSE Mount Fails

**Error**: `fusermount: failed to open /dev/fuse: Permission denied`

**Solution**: 
- Ensure `--cap-add SYS_ADMIN` and `--device /dev/fuse` are set
- Check that FUSE is installed in container: `apt-get install fuse3 fuse`

### Arc Not Found

**Error**: `arc: command not found`

**Solution**:
- Install arc in Dockerfile, or
- Mount arc binary from host: `-v /usr/bin/arc:/usr/bin/arc:ro`

### Network Access Issues

**Error**: Cannot connect to Arcadia servers

**Solution**:
- Ensure VPN is running (if required)
- Check network configuration in Docker
- Verify firewall rules

### Mount Conflicts

**Error**: Mount point already in use

**Solution**:
- Each container should use unique mount point
- Current setup uses `/arcadia` per container (isolated)

## Performance Considerations

1. **Mount overhead**: Each `arc mount` consumes resources
2. **Network latency**: Accessing Arcadia servers over network
3. **Disk I/O**: FUSE adds filesystem layer overhead
4. **Memory**: Each container needs memory for mount cache

## Alternative Approaches

### 1. Pre-mounted Arcadia

Mount Arcadia once on host, share read-only with containers:
- Pros: Faster, less resource usage
- Cons: All containers see same branch, less isolation

### 2. Copy Arcadia to Container

Copy Arcadia files into container image:
- Pros: No network access needed, fast
- Cons: Large image size, not suitable for different branches

### 3. Volume with Different Branches

Use Docker volumes with different branch checkouts:
- Pros: Better isolation, can pre-checkout branches
- Cons: More complex setup, requires branch management

## Current Implementation

The current implementation in `scripts/docker.js`:

1. Uses `ubuntu:22.04` base image with FUSE support
2. Adds `--cap-add SYS_ADMIN` and `--device /dev/fuse` flags
3. Mounts Arcadia inside each container at `/arcadia`
4. Each container runs independently with its own mount

## Recommendations

Based on best practices and requirements:

1. ✅ **Use Ubuntu base image** - Better FUSE and tool support
2. ✅ **Install FUSE in image** - Required for arc mount
3. ✅ **Use minimal privileges** - `--cap-add SYS_ADMIN` instead of `--privileged`
4. ✅ **Mount Arcadia per container** - Full isolation for different branches
5. ⚠️ **Install arc/ya in image** - For better isolation (or mount from host)
6. ✅ **Set resource limits** - Prevent resource exhaustion
7. ✅ **Auto-remove containers** - Use `--rm` flag

## Future Improvements

1. **Pre-built image with arc/ya**: Create base image with all tools pre-installed
2. **Branch-specific containers**: Pre-checkout specific branches before container start
3. **Mount caching**: Share FUSE cache between containers (if same branch)
4. **Health checks**: Monitor mount status and container health
5. **Graceful unmount**: Ensure proper cleanup on container exit
