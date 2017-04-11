{-# LANGUAGE OverloadedStrings #-}
module ADL.Sys.Adlast(
    Annotations,
    Decl(..),
    DeclType(..),
    DeclVersions,
    Field(..),
    Ident,
    Import(..),
    Literal(..),
    Module(..),
    ModuleName,
    NewType(..),
    ScopedName(..),
    Struct(..),
    TypeDef(..),
    TypeExpr(..),
    TypeRef(..),
    Union(..),
) where

import ADL.Core
import Control.Applicative( (<$>), (<*>), (<|>) )
import qualified ADL.Sys.Types
import qualified Data.Aeson as JS
import qualified Data.HashMap.Strict as HM
import qualified Data.Int
import qualified Data.Proxy
import qualified Data.Text as T
import qualified Data.Word
import qualified Prelude

type Annotations = (ADL.Sys.Types.Map ScopedName Literal)

data Decl = Decl
    { decl_name :: Ident
    , decl_version :: (ADL.Sys.Types.Maybe Data.Word.Word32)
    , decl_type_ :: DeclType
    , decl_annotations :: Annotations
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Decl where
    atype _ = "sys.adlast.Decl"
    
    defaultv = Decl
        defaultv
        defaultv
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "name" decl_name
        , genField "version" decl_version
        , genField "type_" decl_type_
        , genField "annotations" decl_annotations
        ]
    
    jsonParser = Decl
        <$> parseField "name"
        <*> parseField "version"
        <*> parseField "type_"
        <*> parseField "annotations"

data DeclType
    = DeclType_struct_ Struct
    | DeclType_union_ Union
    | DeclType_type_ TypeDef
    | DeclType_newtype_ NewType
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue DeclType where
    atype _ = "sys.adlast.DeclType"
    
    defaultv = DeclType_struct_ defaultv
    
    jsonGen = genUnion (\jv -> case jv of
        DeclType_struct_ v -> genUnionValue "struct_" v
        DeclType_union_ v -> genUnionValue "union_" v
        DeclType_type_ v -> genUnionValue "type_" v
        DeclType_newtype_ v -> genUnionValue "newtype_" v
        )
    
    jsonParser
        =   parseUnionValue "struct_" DeclType_struct_
        <|> parseUnionValue "union_" DeclType_union_
        <|> parseUnionValue "type_" DeclType_type_
        <|> parseUnionValue "newtype_" DeclType_newtype_

type DeclVersions = [Decl]

data Field = Field
    { field_name :: Ident
    , field_typeExpr :: TypeExpr
    , field_default :: (ADL.Sys.Types.Maybe Literal)
    , field_annotations :: Annotations
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Field where
    atype _ = "sys.adlast.Field"
    
    defaultv = Field
        defaultv
        defaultv
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "name" field_name
        , genField "typeExpr" field_typeExpr
        , genField "default" field_default
        , genField "annotations" field_annotations
        ]
    
    jsonParser = Field
        <$> parseField "name"
        <*> parseField "typeExpr"
        <*> parseField "default"
        <*> parseField "annotations"

type Ident = T.Text

data Import
    = Import_moduleName ModuleName
    | Import_scopedName ScopedName
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Import where
    atype _ = "sys.adlast.Import"
    
    defaultv = Import_moduleName defaultv
    
    jsonGen = genUnion (\jv -> case jv of
        Import_moduleName v -> genUnionValue "moduleName" v
        Import_scopedName v -> genUnionValue "scopedName" v
        )
    
    jsonParser
        =   parseUnionValue "moduleName" Import_moduleName
        <|> parseUnionValue "scopedName" Import_scopedName

data Literal
    = Literal_null
    | Literal_integer Data.Int.Int64
    | Literal_double Prelude.Double
    | Literal_string T.Text
    | Literal_boolean Prelude.Bool
    | Literal_array [Literal]
    | Literal_object (ADL.Sys.Types.Map T.Text Literal)
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Literal where
    atype _ = "sys.adlast.Literal"
    
    defaultv = Literal_null
    
    jsonGen = genUnion (\jv -> case jv of
        Literal_null -> genUnionVoid "null"
        Literal_integer v -> genUnionValue "integer" v
        Literal_double v -> genUnionValue "double" v
        Literal_string v -> genUnionValue "string" v
        Literal_boolean v -> genUnionValue "boolean" v
        Literal_array v -> genUnionValue "array" v
        Literal_object v -> genUnionValue "object" v
        )
    
    jsonParser
        =   parseUnionVoid "null" Literal_null
        <|> parseUnionValue "integer" Literal_integer
        <|> parseUnionValue "double" Literal_double
        <|> parseUnionValue "string" Literal_string
        <|> parseUnionValue "boolean" Literal_boolean
        <|> parseUnionValue "array" Literal_array
        <|> parseUnionValue "object" Literal_object

data Module = Module
    { module_name :: ModuleName
    , module_imports :: [Import]
    , module_decls :: (ADL.Sys.Types.Map Ident Decl)
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Module where
    atype _ = "sys.adlast.Module"
    
    defaultv = Module
        defaultv
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "name" module_name
        , genField "imports" module_imports
        , genField "decls" module_decls
        ]
    
    jsonParser = Module
        <$> parseField "name"
        <*> parseField "imports"
        <*> parseField "decls"

type ModuleName = T.Text

data NewType = NewType
    { newType_typeParams :: [Ident]
    , newType_typeExpr :: TypeExpr
    , newType_default :: (ADL.Sys.Types.Maybe Literal)
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue NewType where
    atype _ = "sys.adlast.NewType"
    
    defaultv = NewType
        defaultv
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "typeParams" newType_typeParams
        , genField "typeExpr" newType_typeExpr
        , genField "default" newType_default
        ]
    
    jsonParser = NewType
        <$> parseField "typeParams"
        <*> parseField "typeExpr"
        <*> parseField "default"

data ScopedName = ScopedName
    { scopedName_moduleName :: ModuleName
    , scopedName_name :: Ident
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue ScopedName where
    atype _ = "sys.adlast.ScopedName"
    
    defaultv = ScopedName
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "moduleName" scopedName_moduleName
        , genField "name" scopedName_name
        ]
    
    jsonParser = ScopedName
        <$> parseField "moduleName"
        <*> parseField "name"

data Struct = Struct
    { struct_typeParams :: [Ident]
    , struct_fields :: [Field]
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Struct where
    atype _ = "sys.adlast.Struct"
    
    defaultv = Struct
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "typeParams" struct_typeParams
        , genField "fields" struct_fields
        ]
    
    jsonParser = Struct
        <$> parseField "typeParams"
        <*> parseField "fields"

data TypeDef = TypeDef
    { typeDef_typeParams :: [Ident]
    , typeDef_typeExpr :: TypeExpr
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue TypeDef where
    atype _ = "sys.adlast.TypeDef"
    
    defaultv = TypeDef
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "typeParams" typeDef_typeParams
        , genField "typeExpr" typeDef_typeExpr
        ]
    
    jsonParser = TypeDef
        <$> parseField "typeParams"
        <*> parseField "typeExpr"

data TypeExpr = TypeExpr
    { typeExpr_typeRef :: TypeRef
    , typeExpr_parameters :: [TypeExpr]
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue TypeExpr where
    atype _ = "sys.adlast.TypeExpr"
    
    defaultv = TypeExpr
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "typeRef" typeExpr_typeRef
        , genField "parameters" typeExpr_parameters
        ]
    
    jsonParser = TypeExpr
        <$> parseField "typeRef"
        <*> parseField "parameters"

data TypeRef
    = TypeRef_primitive Ident
    | TypeRef_typeParam Ident
    | TypeRef_reference ScopedName
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue TypeRef where
    atype _ = "sys.adlast.TypeRef"
    
    defaultv = TypeRef_primitive defaultv
    
    jsonGen = genUnion (\jv -> case jv of
        TypeRef_primitive v -> genUnionValue "primitive" v
        TypeRef_typeParam v -> genUnionValue "typeParam" v
        TypeRef_reference v -> genUnionValue "reference" v
        )
    
    jsonParser
        =   parseUnionValue "primitive" TypeRef_primitive
        <|> parseUnionValue "typeParam" TypeRef_typeParam
        <|> parseUnionValue "reference" TypeRef_reference

data Union = Union
    { union_typeParams :: [Ident]
    , union_fields :: [Field]
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

instance AdlValue Union where
    atype _ = "sys.adlast.Union"
    
    defaultv = Union
        defaultv
        defaultv
    
    jsonGen = genObject
        [ genField "typeParams" union_typeParams
        , genField "fields" union_fields
        ]
    
    jsonParser = Union
        <$> parseField "typeParams"
        <*> parseField "fields"