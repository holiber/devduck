# Arc Installation on Linux

## Overview

This document describes the process of installing the Arc client on Linux systems (Ubuntu and other distributions).

## Quick Start for Ubuntu

### Step 1: Update Package List

```bash
sudo apt update
```

### Step 2: Install Arc

```bash
sudo apt -y install yandex-arc-launcher
```

### Step 3: Enable Automatic Updates (Ubuntu 16.04 Xenial and later)

```bash
systemctl --user enable --now arc-update.timer
```

## Installation Verification

After installation, verify that Arc is installed correctly:

```bash
arc -v
```

The version of the installed Arc client should be displayed.

## Mounting Arcadia

After installing Arc, you can mount Arcadia:

```bash
arc mount ~/arcadia --allow-other
```

**Important:** The `--allow-other` flag is required for Docker containers and for other users to access the mounted Arcadia.

## FUSE Configuration for Docker

If you plan to use Arc in Docker containers, you need to configure FUSE:

### 1. Add `user_allow_other` to `/etc/fuse.conf`

```bash
echo "user_allow_other" | sudo tee -a /etc/fuse.conf
```

### 2. Ensure fuse3 is installed

```bash
sudo apt install -y fuse3
```

## Repository

The `yandex-arc-launcher` package should be available from the standard Yandex repository. If the repository is not configured automatically, check for the repository:

```bash
grep -R 'common.dist.yandex.ru/common.*stable' /etc/apt/sources.list*
```

If the repository is not found, it should be configured automatically when installing the package or through corporate tools.

## Other Linux Distributions

For other Linux distributions, the installation process may differ. Refer to the official documentation or use pre-built Docker images with Arc pre-installed.

## Troubleshooting

### Issue: `yandex-arc-launcher` not found in repositories

**Solution:**
1. Ensure the Yandex repository is configured correctly
2. Check repository availability: `curl -I http://common.dist.yandex.ru/common/stable/`
3. Refer to Yandex repository setup documentation

### Issue: Arc cannot mount Arcadia in Docker

**Solution:**
1. Ensure the container is started with flags:
   - `--cap-add SYS_ADMIN`
   - `--device /dev/fuse`
   - `--security-opt apparmor=unconfined` (optional)
2. Check that `/etc/fuse.conf` contains `user_allow_other`
3. Use `arc mount --allow-other` when mounting

## Additional Resources

- [Official Arc Documentation](https://docs.yandex-team.ru/devtools/src/monorepository)
- [Quick Start Guide](https://docs.yandex-team.ru/devtools/intro/quick-start-guide)
- [Development Environment Setup](https://docs.yandex-team.ru/dev/setup-environment/devtools)
