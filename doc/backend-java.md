# ADL java backend

```
Usage: adl java [OPTION...] files...
  -I DIR  --searchdir=DIR            Add the specifed directory to the ADL searchpath
  -O DIR  --outputdir=DIR            Set the directory where generated code is written
          --merge-adlext=EXT         Add the specifed adl file extension to merged on loading
          --verbose                  Print extra diagnostic information, especially about files being read/written
          --no-overwrite             Don't update files that haven't changed
          --package=PACKAGE          The language package into which the generated ADL code will be placed
          --include-rt               Generate the runtime code
          --rtpackage=PACKAGE        The java package where the ADL runtime is located
          --parcelable               Generated java code will include android parcellable implementations
          --json                     Generated java code will include gson json serialization
          --hungarian-naming         Use hungarian naming conventions
          --max-line-length=PACKAGE  The maximum length of the generated code lines
          --header-comment=PACKAGE   A comment to be placed at the start of each java file
```
