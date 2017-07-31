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

# Generated Code

The java backend generates java code from the input ADL files. Each
ADL module results in a java package - individual ADL declarations
will produce a source file inside that package.

The `--package` compiler flag specified the root package for generated
java code. Hence, an adl declaration for `SomeStruct` module `foo.bar`
with the compile flag `--package project1.adl` would result in the
java source file `project1/adl/foo/bar/SomeStruct.java`.

ADL structs and unions:

```
    struct Rectangle
    {
        Double width;
        Double height;
    };

    union Picture
    {
        Circle circle;
        Rectangle rectangle;
        Vector<Picture> composed;
        Translated<Picture> translated;
    };
```

produce java classes (see [Rectangle.java][rect-java],
[Picture.java][pic-java]). The code for ADL structs follows standard
java conventions: private members, accessors, mutators, `hashCode()` and
`equals()`, etc.

Given the lack of sum types in java, for unions the ADL compiler
generates a class with a discriminator enum member, and accessors and
static constructors for each union field. The accessors will throw an
`IllegalStateException` if they are called for a field that doesn't
match the current discriminator value.

ADL newtypes are translated to java classes with a single member
variable. ADL type aliases are eliminated in the generated java code
by substution.

Each generated java class includes static helpers to
construct:

* a [`Factory`][fact-java] for deep coping values and also
for runtime type information.

* a [`JsonBinding`][jb-java] for json serialization

[rect-java]:../haskell/compiler/tests/demo1/java-output/adl/picture/Rectangle.java
[pic-java]:..//haskell/compiler/tests/demo1/java-output/adl/picture/Picture.java
[fact-java]:../java/runtime/src/main/java/org/adl/runtime/Factory.java
[jb-java]:../java/runtime/src/main/java/org/adl/runtime/JsonBinding.java

# Primitive Types

The ADL primitive types are mapped to java types as follows:

| ADL Type                     | Java Type                     |
|------------------------------|-------------------------------|
| `Int8,Int16,Int32,Int64`     | `byte,short,int,long`         |
| `Word8,Word16,Word32,Word64` | `byte,short,int,long`         |
| `Bool`                       | `boolean`                     |
| `Void`                       | `Void`                        |
| `Float,Double`               | `float,double`                |
| `String`                     | `String`                      |
| `ByteVector`                 | `adl.runtime.ByteArray`       |
| `Vector<T>`                  | `java.util.ArrayList<T>`      |
| `StringMap<T>`               | `java.util.HashMap<String,t>` |
| `Nullable<T>`                | `java.util.Optional<T>`       |

Where possible, unboxed primitive values will be used.

# Runtime

The generated code depends upon a small runtime. The location of the
runtime in the java package tree can be controlled with the
`--rtpackage` compiler flag. As a convenience, when the `--include-rt`
flag is specified, the adl compiler will also output the runtime code.

As a concrete example, if the adl compiler is called like this:

```
adlc java\
  --outputdir src \
  --package adl \
  --json \
  --rtpackage adl/runtime \
  --include-rt \
  picture.adl
```
The following files will be created:

```
src/adl/picture/Circle.java
src/adl/picture/Picture.java
src/adl/picture/Rectangle.java
src/adl/picture/Translated.java
src/adl/runtime/ByteArray.java
src/adl/runtime/DynamicHelpers.java
src/adl/runtime/Factories.java
src/adl/runtime/Factory.java
src/adl/runtime/JsonBinding.java
src/adl/runtime/JsonBindings.java
src/adl/runtime/JsonHelpers.java
src/adl/runtime/JsonParseException.java
src/adl/runtime/Lazy.java
```

The runtime itself depends on the following java packages:

* [gson](https://github.com/google/gson)

# Annotations

The java backend merges annotations from files with an `.adl-java`
suffix: eg when loading `demo/model.adl` it will automatically merge
`demo/model.adl-java` if found.

Any `Doc` annotations (which can also be specified using `///`
comments), are included as comments in the generated java code.
