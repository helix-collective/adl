use std::collections::{HashMap, HashSet};

use crate::adlgen::sys::adlast2 as adlast;
use crate::adlrt::custom::sys::types::map::Map;

use super::loader::AdlLoader;
use super::primitives::{prim_from_str, str_from_prim};
use super::{Module0, TypeExpr0};

type Result<T> = std::result::Result<T, ResolveError>;

#[derive(Debug)]
pub enum ResolveError {
    NoDeclForAnnotation,
    ModuleNotFound,
    DeclNotFound,
    LocalNotFound(String),
    CircularModules(ModuleName),
    LoadFailed,
}

pub type TypeRef = adlast::TypeRef;
pub type TypeExpr1 = adlast::TypeExpr1;
pub type Decl1 = adlast::Decl1;
pub type Module1 = adlast::Module1;
pub type ModuleName = adlast::ModuleName;

pub struct Resolver {
    loader: Box<dyn AdlLoader>,
    modules: HashMap<ModuleName, Module1>,
}

impl Resolver {
    pub fn new(loader: Box<dyn AdlLoader>) -> Self {
        Self {
            loader,
            modules: HashMap::new(),
        }
    }

    pub fn add_module(&mut self, module_name: &ModuleName) -> Result<()> {
        let mut in_progress = HashSet::new();
        self.add_module_impl(&mut in_progress, module_name)
    }

    fn add_module_impl(
        &mut self,
        in_progress: &mut HashSet<ModuleName>,
        module_name: &ModuleName,
    ) -> Result<()> {
        if self.modules.contains_key(module_name) {
            return Ok(());
        }

        if in_progress.contains(module_name) {
            return Err(ResolveError::CircularModules(module_name.clone()));
        }

        in_progress.insert(module_name.clone());

        let mut module0 = self
            .loader
            .load(module_name)
            .map_err(|_| ResolveError::LoadFailed)?
            .ok_or_else(|| ResolveError::ModuleNotFound)?;
        self.add_default_imports(&mut module0);

        let module_refs = find_module_refs(&module0);
        for m in &module_refs {
            self.add_module(m)?;
        }

        let type_params = HashSet::new();
        let expanded_imports = self.get_expanded_imports(&module0);
        let mut ctx = ResolveCtx {
            resolver: self,
            module0: &module0,
            expanded_imports: &expanded_imports,
            type_params,
        };
        let module1 = resolve_module(&mut ctx, &module0)?;
        self.modules.insert(module_name.clone(), module1);

        in_progress.remove(module_name);

        Ok(())
    }

    pub fn get_module_names(&self) -> Vec<ModuleName> {
        self.modules.keys().cloned().collect()
    }

    pub fn get_module(&self, module_name: &ModuleName) -> Option<&Module1> {
        self.modules.get(module_name)
    }

    pub fn get_decl(&mut self, scoped_name: &adlast::ScopedName) -> Option<&Decl1> {
        match self.get_module(&scoped_name.module_name) {
            None => None,
            Some(module1) => return module1.decls.get(&scoped_name.name),
        }
    }

    pub fn add_default_imports(&self, module: &mut Module0) {
        let default_imports = vec!["sys.annotations"];
        for din in default_imports {
            let di = adlast::Import::ModuleName(din.to_owned());
            if module.name.value != din && !module.imports.contains(&di) {
                module.imports.push(di);
            }
        }
    }

    pub fn get_expanded_imports(&self, module: &Module0) -> HashMap<String, adlast::ScopedName> {
        let mut result = HashMap::new();
        for i in &module.imports {
            match i {
                adlast::Import::ScopedName(sn) => {
                    result.insert(sn.name.clone(), sn.clone());
                }
                adlast::Import::ModuleName(mn) => {
                    if let Some(m) = self.get_module(&mn) {
                        for decl_name in m.decls.keys() {
                            result.insert(
                                decl_name.clone(),
                                adlast::ScopedName {
                                    module_name: m.name.value.clone(),
                                    name: decl_name.clone(),
                                },
                            );
                        }
                    }
                }
            }
        }
        result
    }
}

pub fn resolve_module(ctx: &mut ResolveCtx, module0: &Module0) -> Result<Module1> {
    let decls1 = module0
        .decls
        .iter()
        .map(|(n, decl0)| {
            let decl1 = resolve_decl(ctx, &decl0)?;
            Ok((n.clone(), decl1))
        })
        .collect::<Result<HashMap<_, _>>>()?;
    let annotations1 = resolve_annotations(ctx, &module0.annotations)?;
    let module1 = adlast::Module::new(
        module0.name.clone(),
        module0.imports.clone(),
        decls1,
        annotations1,
    );
    Ok(module1)
}

pub fn resolve_decl(
    ctx: &mut ResolveCtx,
    decl0: &adlast::Decl<TypeExpr0>,
) -> Result<adlast::Decl<TypeExpr1>> {
    let dtype = match &decl0.r#type {
        adlast::DeclType::Struct(s) => resolve_struct(ctx, &s)?,
        adlast::DeclType::Union(u) => resolve_union(ctx, &u)?,
        adlast::DeclType::Type(t) => resolve_type_alias(ctx, &t)?,
        adlast::DeclType::Newtype(n) => resolve_newtype(ctx, &n)?,
    };
    let annotations = resolve_annotations(ctx, &decl0.annotations)?;
    let decl = adlast::Decl::new(
        decl0.name.clone(),
        decl0.version.clone(),
        dtype,
        annotations,
    );
    Ok(decl)
}

pub fn resolve_struct(
    ctx0: &mut ResolveCtx,
    struct0: &adlast::Struct<TypeExpr0>,
) -> Result<adlast::DeclType<TypeExpr1>> {
    let ctx = with_type_params(ctx0, &struct0.type_params);
    let fields = resolve_fields(&ctx, &struct0.fields)?;
    let struct1 = adlast::Struct::new(struct0.type_params.clone(), fields);
    Ok(adlast::DeclType::Struct(struct1))
}

pub fn resolve_union(
    ctx0: &mut ResolveCtx,
    union0: &adlast::Union<TypeExpr0>,
) -> Result<adlast::DeclType<TypeExpr1>> {
    let ctx = with_type_params(ctx0, &union0.type_params);
    let fields = resolve_fields(&ctx, &union0.fields)?;
    let union1 = adlast::Union::new(union0.type_params.clone(), fields);
    Ok(adlast::DeclType::Union(union1))
}

pub fn resolve_type_alias(
    ctx0: &mut ResolveCtx,
    type0: &adlast::TypeDef<TypeExpr0>,
) -> Result<adlast::DeclType<TypeExpr1>> {
    let ctx = with_type_params(ctx0, &type0.type_params);
    let type_expr1 = resolve_type_expr(&ctx, &type0.type_expr)?;
    let type1 = adlast::TypeDef::new(type0.type_params.clone(), type_expr1);
    Ok(adlast::DeclType::Type(type1))
}

pub fn resolve_newtype(
    ctx0: &mut ResolveCtx,
    newtype0: &adlast::NewType<TypeExpr0>,
) -> Result<adlast::DeclType<TypeExpr1>> {
    let ctx = with_type_params(ctx0, &newtype0.type_params);
    let type_expr1 = resolve_type_expr(&ctx, &newtype0.type_expr)?;
    let newtype1 = adlast::NewType::new(
        newtype0.type_params.clone(),
        type_expr1,
        newtype0.default.clone(),
    );
    Ok(adlast::DeclType::Newtype(newtype1))
}

pub fn resolve_fields(
    ctx: &ResolveCtx,
    fields0: &Vec<adlast::Field<TypeExpr0>>,
) -> Result<Vec<adlast::Field<TypeExpr1>>> {
    fields0
        .iter()
        .map(|f| resolve_field(ctx, f))
        .collect::<Result<Vec<_>>>()
}

pub fn resolve_field(
    ctx: &ResolveCtx,
    field0: &adlast::Field<TypeExpr0>,
) -> Result<adlast::Field<TypeExpr1>> {
    let field1 = adlast::Field::new(
        field0.name.clone(),
        field0.serialized_name.clone(),
        resolve_type_expr(ctx, &field0.type_expr)?,
        field0.default.clone(),
        resolve_annotations(ctx, &field0.annotations)?,
    );
    Ok(field1)
}

pub fn resolve_annotations(
    ctx: &ResolveCtx,
    annotations0: &adlast::Annotations,
) -> Result<adlast::Annotations> {
    let hm1 = annotations0
        .0
        .iter()
        .map(|(sn0, jv)| {
            let tr1 = ctx.resolve_type_ref(sn0)?;
            if let TypeRef::ScopedName(sn1) = tr1 {
                Ok((sn1, jv.clone()))
            } else {
                Err(ResolveError::NoDeclForAnnotation)
            }
        })
        .collect::<Result<HashMap<_, _>>>()?;
    Ok(Map(hm1))
}

pub fn resolve_type_expr(ctx: &ResolveCtx, typeexpr0: &TypeExpr0) -> Result<TypeExpr1> {
    let type_ref = ctx.resolve_type_ref(&typeexpr0.type_ref)?;
    let parameters = typeexpr0
        .parameters
        .iter()
        .map(|p| resolve_type_expr(ctx, p))
        .collect::<Result<Vec<_>>>()?;
    let type_expr = adlast::TypeExpr::new(type_ref, parameters);
    Ok(type_expr)
}

pub struct ResolveCtx<'a> {
    resolver: &'a mut Resolver,
    module0: &'a Module0,
    expanded_imports: &'a HashMap<adlast::Ident, adlast::ScopedName>,
    type_params: HashSet<String>,
}

impl<'a> ResolveCtx<'a> {
    pub fn find_module(&self, module_name: &ModuleName) -> Result<Option<&Module1>> {
        Ok(self.resolver.get_module(module_name))
    }

    pub fn resolve_type_ref(&self, scoped_name0: &adlast::ScopedName) -> Result<TypeRef> {
        if scoped_name0.module_name.is_empty() {
            let name = &scoped_name0.name;
            if self.type_params.contains(name.as_str()) {
                return Ok(TypeRef::TypeParam(name.clone()));
            }
            if let Some(ptype) = prim_from_str(&name) {
                return Ok(TypeRef::Primitive(ptype));
            }
            if self.module0.decls.contains_key(name) {
                return Ok(TypeRef::LocalName(name.clone()));
            }
            if let Some(scoped_name) = self.expanded_imports.get(name) {
                return Ok(TypeRef::ScopedName(scoped_name.clone()));
            }
            Err(ResolveError::LocalNotFound(name.clone()))
        } else {
            match self.find_module(&scoped_name0.module_name)? {
                None => return Err(ResolveError::ModuleNotFound),
                Some(module1) => match module1.decls.get(&scoped_name0.name) {
                    None => return Err(ResolveError::DeclNotFound),
                    Some(_) => return Ok(TypeRef::ScopedName(scoped_name0.clone())),
                },
            }
        }
    }
}

fn with_type_params<'a>(
    ctx0: &'a mut ResolveCtx,
    type_params: &'a Vec<adlast::Ident>,
) -> ResolveCtx<'a> {
    ResolveCtx {
        resolver: ctx0.resolver,
        module0: ctx0.module0,
        expanded_imports: ctx0.expanded_imports,
        type_params: type_params_set(type_params),
    }
}

fn type_params_set(type_params: &Vec<adlast::Ident>) -> HashSet<String> {
    type_params
        .iter()
        .map(|i| i.clone())
        .collect::<HashSet<_>>()
}

fn find_module_refs(module: &Module0) -> HashSet<ModuleName> {
    struct C {
        refs: HashSet<ModuleName>,
    }
    impl AstConsumer<adlast::ScopedName> for C {
        fn consume_typeref(&mut self, sn: adlast::ScopedName) -> () {
            self.consume_scoped_name(sn)
        }
        fn consume_scoped_name(&mut self, sn: adlast::ScopedName) {
            if sn.module_name != "" {
                self.refs.insert(sn.module_name);
            }
        }
    }
    let mut ac = C {
        refs: HashSet::new(),
    };
    consume_module(module, &mut ac);
    for i in &module.imports {
        match i {
            adlast::Import::ModuleName(mn) => ac.refs.insert(mn.clone()),
            adlast::Import::ScopedName(sn) => ac.refs.insert(sn.module_name.clone()),
        };
    }
    ac.refs
}

pub fn consume_module<T: Clone>(
    module: &adlast::Module<adlast::TypeExpr<T>>,
    ac: &mut dyn AstConsumer<T>,
) {
    consume_annotations(&module.annotations, ac);
    for (_, decl) in &module.decls {
        consume_decl(decl, ac);
    }
}

pub fn consume_decl<T: Clone>(
    decl: &adlast::Decl<adlast::TypeExpr<T>>,
    ac: &mut dyn AstConsumer<T>,
) {
    consume_annotations(&decl.annotations, ac);
    match &decl.r#type {
        adlast::DeclType::Struct(s) => consume_fields(&s.fields, ac),
        adlast::DeclType::Union(u) => consume_fields(&u.fields, ac),
        adlast::DeclType::Type(t) => consume_type_expr(&t.type_expr, ac),
        adlast::DeclType::Newtype(n) => consume_type_expr(&n.type_expr, ac),
    }
}

pub fn consume_fields<T: Clone>(
    fields: &Vec<adlast::Field<adlast::TypeExpr<T>>>,
    ac: &mut dyn AstConsumer<T>,
) {
    for f in fields {
        consume_field(f, ac);
    }
}

pub fn consume_field<T: Clone>(
    field: &adlast::Field<adlast::TypeExpr<T>>,
    ac: &mut dyn AstConsumer<T>,
) {
    consume_annotations(&field.annotations, ac);
    consume_type_expr(&field.type_expr, ac);
}

pub fn consume_annotations<T>(annotations: &adlast::Annotations, ac: &mut dyn AstConsumer<T>) {
    for a in annotations.0.keys() {
        ac.consume_scoped_name(a.clone());
    }
}

pub fn consume_type_expr<T: Clone>(typeexpr: &adlast::TypeExpr<T>, ac: &mut dyn AstConsumer<T>) {
    ac.consume_typeref(typeexpr.type_ref.clone());
    for p in &typeexpr.parameters {
        consume_type_expr(p, ac);
    }
}

pub trait AstConsumer<TR> {
    fn consume_typeref(&mut self, t: TR) -> ();
    fn consume_scoped_name(&mut self, sn: adlast::ScopedName) -> ();
}
