#!/bin/bash

# set -e

if [ -z "$2" ]
then
  echo "Usage: ./aws_multi.sh <scenario> <trial>"
  exit 1
fi

frameworks=("collabs" "collabsNoVC" "yjs" "automerge" "sharedb")

# for numUsers in "16" "32" "48" "64" "80" "96" "112" "128" "144"
for numUsers in "144" "128" "112" "96" "80" "64" "48" "32" "16"
do
  # Loop over frameworks in random order, to avoid bias.
  for framework in $(shuf -e "${frameworks[@]}")
  do
    echo "================================================================================"
    echo "numUsers = $numUsers, framework = $framework"
    echo "================================================================================"
    # Use || to retry once on failure.
    npm run aws data $1 $numUsers $framework $2 || npm run aws data $1 $numUsers $framework $2
    # Pause a bit between trials.
    sleep 5
  done
done