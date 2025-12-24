# Smogcheck CI Provider

Test provider for the CI module.

## Purpose

This provider returns mock data for testing CI functionality without requiring actual API access.

## Capabilities

- `fetchPR` - Returns mock PR information
- `fetchCheckStatus` - Returns mock check status with annotations
- `fetchComments` - Returns mock comments and reactions

## Test Data

The provider includes mock data for:
- 2 sample PRs (pr-1, pr-2)
- Check statuses with annotations for failed checks
- Comments with reactions

## Usage

This provider is automatically discovered and registered when the CI module is loaded. It can be used for testing and development.

