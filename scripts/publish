#!/bin/sh

# Get a temporary index file to work with.
INDEX="$(mktemp -d)/index"

for FILE in $(find images public -type f -and -not -name '.*'); do
  # Add file contents to object database.
  BLOB_ID=$(git hash-object -w -- "$FILE")

  # Add file to index.
  MODE=100644
  NAME=$(basename "$FILE")
  env GIT_INDEX_FILE="$INDEX" git update-index \
    --add \
    --cacheinfo "${MODE},${BLOB_ID},${NAME}"
done

# Special file: "CNAME" for GitHub pages custom domain.
# See: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-a-subdomain
BLOB_ID=$(/bin/echo -n greg.hurrell.net | git hash-object -w --stdin)
MODE=100644
NAME=CNAME
env GIT_INDEX_FILE="$INDEX" git update-index \
  --add \
  --cacheinfo "${MODE},${BLOB_ID},${NAME}"

# Create tree object from index.
TREE_ID=$(env GIT_INDEX_FILE="$INDEX" git write-tree)

# Make the commit.
DATE=$(date)
PARENT=$(git rev-parse refs/heads/gh-pages)
SOURCE=$(git describe --always --dirty)
COMMIT=$(builtin echo "Build $DATE\n\nFrom $SOURCE." | git commit-tree "$TREE_ID" -p "$PARENT" -F -)

git update-ref refs/heads/gh-pages "$COMMIT"

echo "Created commit: $(git rev-parse --short "$COMMIT")\n"

git log --raw -1 refs/heads/gh-pages

if $(git diff --quiet "$COMMIT" "$PARENT"); then
  BOLD=$(tput bold)
  RED=$(tput setaf 1)
  RESET=$(tput sgr0)
  echo "\n${BOLD}${RED}WARNING: CREATED EMPTY COMMIT${RESET}\n"
  echo "If this was in error, reset using:"
  echo "  git update-ref refs/heads/gh-pages $(git rev-parse --short "$PARENT")"
fi
