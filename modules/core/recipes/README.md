# Recipes

This folder contains **recipes**: short, reusable playbooks that help the AI (and humans) solve recurring tasks in this project **faster** and with **fewer tokens**.

## When to create or update a recipe

This repo follows a **no-duplication** rule for recipes:

- If the topic is already documented somewhere in the repo (README, `.cursor/commands/*`, `.cursorrules`, scripts usage text, etc.), do **not** create a recipe.
  - Instead, **propose improving that existing documentation** in the moment.
- If there is no documentation:
  - If a relevant recipe already exists, **extend** it.
  - Otherwise, create a new recipe.

Recipes are especially useful when a task required multiple attempts (several approaches failed before the correct one was found) and the final solution should be reusable.

## Recipe format (recommended)

Each recipe is a markdown file:
- File name: `<short-title>.md`
- Language: English

Recommended sections:
- **Problem**: what we tried to achieve
- **Solution**: final working approach
- **Gotchas**: pitfalls, sandbox restrictions, required permissions

## Statistics

`recipies-stats.json` stores usage stats per recipe (to track which recipes are useful):
- `uses`: total number of times a recipe was used
- `lastUsedAt`: last usage date (ISO)

Notes:
- Update stats when you apply or extend a recipe.
- If a recipe is unused for a long time, it might be outdated.
