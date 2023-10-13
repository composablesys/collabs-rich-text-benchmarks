#!/bin/bash

# To prevent cross-doc memory interference, memory.ts only measures
# one doc at a time. We use this script to still let you supply
# multiple input files to `npm run memory`.

if [ -z "$2" ]
then
  echo "Usage: npm run memory <output file> <input files...>"
  echo "where":
  echo "- Output file is the csv file to append output to (creating if needed)"
  echo "- Each input file contains the saved states after running a framework (extension .savedState)"
  exit 1
fi

argc=$#
argv=("$@")

for (( j=1; j<argc; j++ )); do
    npm run memoryOne "$1" "${argv[j]}"
done