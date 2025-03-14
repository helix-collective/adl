#!/bin/bash -xe

HASKELL_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd $HASKELL_DIR

ADL_STDLIB_DIR=compiler/lib/adl
CONFIG_ADL_DIR=compiler/lib/adl/adlc/config

adlcb () {
  stack exec adlc-bootstrap -- haskell --package=ADL --no-overwrite -I$ADL_STDLIB_DIR "$@"
}

# Start clean, and build the bootstrap compiler
stack clean
stack build --flag adl-compiler:bootstrap adl-compiler:adlc-bootstrap

# Generate the haskell code for the per-language annotation types
adlcb -I $CONFIG_ADL_DIR -O compiler/adlc-lib1 $CONFIG_ADL_DIR/haskell.adl
adlcb -I $CONFIG_ADL_DIR -O compiler/adlc-lib1 $CONFIG_ADL_DIR/cpp.adl
adlcb -I $CONFIG_ADL_DIR -O compiler/adlc-lib1 $CONFIG_ADL_DIR/java.adl
adlcb -I $CONFIG_ADL_DIR -O compiler/adlc-lib1 $CONFIG_ADL_DIR/typescript.adl
adlcb -I $CONFIG_ADL_DIR -O compiler/adlc-lib1 $CONFIG_ADL_DIR/rust.adl

# Generate ADL specified elements of the haskell runtime
adlcb -O runtime/src $ADL_STDLIB_DIR/sys/types.adl
adlcb -O runtime/src $ADL_STDLIB_DIR/sys/adlast.adl

# Build and test the compiler itself
stack build --test adl-compiler 

# Generate ADL specified elements of the typescript runtime
# these are in the style "template" so they can be converted
# to tsc or deno style later
stack exec adlc -- typescript \
 --no-overwrite \
 --exclude-ast \
 --verbose \
 --ts-style template \
 -O ../typescript/runtime/embedded \
 -I $ADL_STDLIB_DIR \
 $ADL_STDLIB_DIR/sys/types.adl $ADL_STDLIB_DIR/sys/adlast.adl $ADL_STDLIB_DIR/sys/dynamic.adl
stack exec adlc -- typescript \
 --no-overwrite \
 --exclude-ast \
 --verbose \
 --ts-style deno \
 -O ../typescript/runtime/published/src \
 -I $ADL_STDLIB_DIR \
 $ADL_STDLIB_DIR/sys/types.adl $ADL_STDLIB_DIR/sys/adlast.adl $ADL_STDLIB_DIR/sys/dynamic.adl

# Generate ADL specified elements of the c++ runtime
CPP_RUNTIME_DIR=../cpp/runtime/src-generated 
stack exec adlc -- cpp \
 --no-overwrite \
 --verbose \
 --include-prefix adl \
 -O $CPP_RUNTIME_DIR \
 -I $ADL_STDLIB_DIR \
 $ADL_STDLIB_DIR/sys/types.adl $ADL_STDLIB_DIR/sys/adlast.adl $ADL_STDLIB_DIR/sys/dynamic.adl

# Generate DENO runtime published at the repo top level
# to tsc or deno style later
stack exec adlc -- typescript \
 --no-overwrite \
 --verbose \
 --ts-style deno \
 -O ../deno/adl-gen \
 -I $ADL_STDLIB_DIR \
 $ADL_STDLIB_DIR/sys/types.adl $ADL_STDLIB_DIR/sys/adlast.adl $ADL_STDLIB_DIR/sys/dynamic.adl

# Run some tests for each target language
stack build generated-tests
(cd ../typescript/tests; ./run-tests.sh)
(cd ../java; gradle build; gradle test)
(cd ../rust/tests; cargo build; cargo test)
(cd ../cpp/tests; ./run-tests.sh)
