{-# LANGUAGE OverloadedStrings #-}

module ADL.Compiler.Backends.JavaTables(
    generateJavaTables
  , javaTableOptions
  , defaultJavaTableFlags
  , JavaTableFlags(..)
  ) where

import qualified Data.Aeson as JS
import qualified Data.HashMap.Strict as HM
import qualified Data.ByteString.Lazy as LBS
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import qualified Data.Vector as V
import qualified ADL.Compiler.AST as AST
import qualified ADL.Compiler.Backends.Java.Internal as J
import qualified ADL.Compiler.Backends.Java as J
import qualified ADL.Compiler.Backends.JavaTables.SchemaUtils as SC
import qualified ADL.Compiler.Backends.JavaTables.Schema as SC

import ADL.Compiler.EIO
import ADL.Compiler.Primitive
import ADL.Compiler.Processing(AdlFlags(..),ResolvedType(..), RModule,RDecl,defaultAdlFlags,loadAndCheckModule1,removeModuleTypedefs, expandModuleTypedefs, associateCustomTypes, refEnumeration, refNewtype, ResolvedTypeT(..))
import ADL.Compiler.Utils(FileWriter,withManifest)
import ADL.Compiler.Flags(Flags(..),parseArguments,standardOptions, addToMergeFileExtensions)
import ADL.Compiler.Backends.JavaTables.JavaUtils
import ADL.Compiler.Backends.JavaTables.V1
import ADL.Compiler.Backends.JavaTables.V2
import ADL.Utils.IndentedCode
import ADL.Utils.Format(template,formatText)
import Control.Monad(when)
import Control.Monad.Trans(liftIO)
import Control.Monad.Trans.State.Strict
import Data.Char(toUpper, isUpper)
import Data.Foldable(for_)
import Data.Traversable(for)
import Data.List(intersperse,find)
import Data.Monoid
import Data.Maybe(mapMaybe)
import System.Directory(createDirectoryIfMissing)
import System.FilePath(takeDirectory,(</>))
import System.Console.GetOpt(OptDescr(..), ArgDescr(..))

javaTableOptions =
  [ Option "" ["rtpackage"]
      (ReqArg (\s f -> f{f_backend=(f_backend f){jt_rtpackage=T.pack s}}) "PACKAGE")
      "The  package where the ADL runtime can be found"
  , Option "" ["package"]
      (ReqArg (\s f -> f{f_backend=(f_backend f){jt_package=T.pack s}}) "PACKAGE")
      "The  package into which the generated ADL code will be placed"
  , Option "" ["crudfns"]
      (NoArg (\f -> f{f_backend=(f_backend f){jt_crudfns=True}}))
      "Generate CRUD helper functions"
  , Option "" ["genversion"]
      (ReqArg (\s f -> f{f_backend=(f_backend f){jt_genversion=decodeVersion s}}) "VERSION")
      "Set the generated model version"
  ]

-- | CLI sub command to read arguments and a list ADL files
-- and generate java code mappinging between ADL objects
-- and database tables
generateJavaTables :: [String] -> EIO T.Text ()
generateJavaTables args = do
  let header = "Usage: generate.hs java-tables ...args..."
      options =  standardOptions <> javaTableOptions
  (flags0,paths) <- parseArguments header defaultAdlFlags defaultJavaTableFlags options args
  let flags = addToMergeFileExtensions "adl-java" flags0
  withManifest (f_output flags) $ \fileWriter -> do
    let cgp = J.defaultCodeGenProfile{J.cgp_runtimePackage=(J.javaPackage (jt_rtpackage (f_backend flags)))}
    for_ paths $ \path -> do
      (mod0,moddeps) <- loadAndCheckModule1 (f_adl flags) path
      let javaPackageFn = J.mkJavaPackageFn cgp (mod0:moddeps) (J.javaPackage (jt_package (f_backend flags)))
          schema = SC.schemaFromAdl SC.postgresDbProfile mod0
          mod = ( associateCustomTypes J.getCustomType (AST.m_name mod0)
                . removeModuleTypedefs
                . expandModuleTypedefs
                ) mod0
      liftIO $ writeModuleJavaTables fileWriter (f_backend flags) cgp javaPackageFn schema mod

-- | Generate the java table mapping code for a resolved ADL module
writeModuleJavaTables :: FileWriter -> JavaTableFlags -> J.CodeGenProfile -> J.JavaPackageFn -> SC.Schema -> J.CModule -> IO ()
writeModuleJavaTables writeFile jtflags cgp javaPackageFn schema rmod = do
  let tableDecls = mapMaybe (matchDBTable schema) (M.elems (AST.m_decls rmod))
  for_ tableDecls $ \(decl,struct,table,annotation,mgenversion) -> do
    let filePath = J.javaClassFilePath (J.javaClass (javaPackageFn (AST.m_name rmod)) (tableClassName decl))
        genversion = case mgenversion of
          (Just v) -> v
          Nothing -> jt_genversion jtflags
        classfile = case genversion of
          V1 -> generateJavaModelV1 jtflags cgp javaPackageFn rmod (decl,struct,table,annotation)
          V2 -> generateJavaModelV2 jtflags cgp javaPackageFn rmod (decl,struct,table,annotation)
        text = (T.intercalate "\n" (codeText Nothing (J.classFileCode classfile)))
    writeFile filePath (LBS.fromStrict (T.encodeUtf8 text))

