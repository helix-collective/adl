/* @generated from adl module test31 */

package adl.test31;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.adl.runtime.Builders;
import org.adl.runtime.Factories;
import org.adl.runtime.Factory;
import org.adl.runtime.JsonBinding;
import org.adl.runtime.JsonBindings;
import org.adl.runtime.Lazy;
import org.adl.runtime.sys.adlast.ScopedName;
import org.adl.runtime.sys.adlast.TypeExpr;
import org.adl.runtime.sys.adlast.TypeRef;
import java.util.ArrayList;
import java.util.Objects;
import java.util.Optional;

public class Defaults {

  /* Members */

  private String withDefault;
  private Leaf structWithDefault;
  private Optional<String> nullableNullDefault;
  private Optional<String> nullableNonNullDefault;
  private String required;

  /* Constructors */

  public Defaults(String withDefault, Leaf structWithDefault, Optional<String> nullableNullDefault, Optional<String> nullableNonNullDefault, String required) {
    this.withDefault = Objects.requireNonNull(withDefault);
    this.structWithDefault = Objects.requireNonNull(structWithDefault);
    this.nullableNullDefault = Objects.requireNonNull(nullableNullDefault);
    this.nullableNonNullDefault = Objects.requireNonNull(nullableNonNullDefault);
    this.required = Objects.requireNonNull(required);
  }

  public Defaults(String required) {
    this.withDefault = defWithDefault();
    this.structWithDefault = defStructWithDefault();
    this.nullableNullDefault = defNullableNullDefault();
    this.nullableNonNullDefault = defNullableNonNullDefault();
    this.required = Objects.requireNonNull(required);
  }

  public Defaults(Defaults other) {
    this.withDefault = other.withDefault;
    this.structWithDefault = Leaf.FACTORY.create(other.structWithDefault);
    this.nullableNullDefault = Factories.nullable(Factories.STRING).create(other.nullableNullDefault);
    this.nullableNonNullDefault = Factories.nullable(Factories.STRING).create(other.nullableNonNullDefault);
    this.required = other.required;
  }

  /* Field defaults */

  public static String defWithDefault() {
    return "abc";
  }

  public static Leaf defStructWithDefault() {
    return new Leaf("xyz");
  }

  public static Optional<String> defNullableNullDefault() {
    return Optional.<String>empty();
  }

  public static Optional<String> defNullableNonNullDefault() {
    return Optional.<String>of("abc");
  }

  /* Accessors and mutators */

  public String getWithDefault() {
    return withDefault;
  }

  public Defaults setWithDefault(String withDefault) {
    this.withDefault = Objects.requireNonNull(withDefault);
    return this;
  }

  public Leaf getStructWithDefault() {
    return structWithDefault;
  }

  public Defaults setStructWithDefault(Leaf structWithDefault) {
    this.structWithDefault = Objects.requireNonNull(structWithDefault);
    return this;
  }

  public Optional<String> getNullableNullDefault() {
    return nullableNullDefault;
  }

  public Defaults setNullableNullDefault(Optional<String> nullableNullDefault) {
    this.nullableNullDefault = Objects.requireNonNull(nullableNullDefault);
    return this;
  }

  public Optional<String> getNullableNonNullDefault() {
    return nullableNonNullDefault;
  }

  public Defaults setNullableNonNullDefault(Optional<String> nullableNonNullDefault) {
    this.nullableNonNullDefault = Objects.requireNonNull(nullableNonNullDefault);
    return this;
  }

  public String getRequired() {
    return required;
  }

  public Defaults setRequired(String required) {
    this.required = Objects.requireNonNull(required);
    return this;
  }

  /* Object level helpers */

  @Override
  public boolean equals(Object other0) {
    if (!(other0 instanceof Defaults)) {
      return false;
    }
    Defaults other = (Defaults) other0;
    return
      withDefault.equals(other.withDefault) &&
      structWithDefault.equals(other.structWithDefault) &&
      nullableNullDefault.equals(other.nullableNullDefault) &&
      nullableNonNullDefault.equals(other.nullableNonNullDefault) &&
      required.equals(other.required);
  }

  @Override
  public int hashCode() {
    int _result = 1;
    _result = _result * 37 + withDefault.hashCode();
    _result = _result * 37 + structWithDefault.hashCode();
    _result = _result * 37 + nullableNullDefault.hashCode();
    _result = _result * 37 + nullableNonNullDefault.hashCode();
    _result = _result * 37 + required.hashCode();
    return _result;
  }

  /* Builder */

  public static class Builder {
    private String withDefault;
    private Leaf structWithDefault;
    private Optional<String> nullableNullDefault;
    private Optional<String> nullableNonNullDefault;
    private String required;

    public Builder() {
      this.withDefault = "abc";
      this.structWithDefault = new Leaf("xyz");
      this.nullableNullDefault = Optional.<String>empty();
      this.nullableNonNullDefault = Optional.<String>of("abc");
      this.required = null;
    }

    public Builder setWithDefault(String withDefault) {
      this.withDefault = Objects.requireNonNull(withDefault);
      return this;
    }

    public Builder setStructWithDefault(Leaf structWithDefault) {
      this.structWithDefault = Objects.requireNonNull(structWithDefault);
      return this;
    }

    public Builder setNullableNullDefault(Optional<String> nullableNullDefault) {
      this.nullableNullDefault = Objects.requireNonNull(nullableNullDefault);
      return this;
    }

    public Builder setNullableNonNullDefault(Optional<String> nullableNonNullDefault) {
      this.nullableNonNullDefault = Objects.requireNonNull(nullableNonNullDefault);
      return this;
    }

    public Builder setRequired(String required) {
      this.required = Objects.requireNonNull(required);
      return this;
    }

    public Defaults create() {
      Builders.checkFieldInitialized("Defaults", "required", required);
      return new Defaults(withDefault, structWithDefault, nullableNullDefault, nullableNonNullDefault, required);
    }
  }

  /* Factory for construction of generic values */

  public static final Factory<Defaults> FACTORY = new Factory<Defaults>() {
    @Override
    public Defaults create(Defaults other) {
      return new Defaults(other);
    }

    @Override
    public TypeExpr typeExpr() {
      ScopedName scopedName = new ScopedName("test31", "Defaults");
      ArrayList<TypeExpr> params = new ArrayList<>();
      return new TypeExpr(TypeRef.reference(scopedName), params);
    }
    @Override
    public JsonBinding<Defaults> jsonBinding() {
      return Defaults.jsonBinding();
    }
  };

  /* Json serialization */

  public static JsonBinding<Defaults> jsonBinding() {
    final Lazy<JsonBinding<String>> withDefault = new Lazy<>(() -> JsonBindings.STRING);
    final Lazy<JsonBinding<Leaf>> structWithDefault = new Lazy<>(() -> Leaf.jsonBinding());
    final Lazy<JsonBinding<Optional<String>>> nullableNullDefault = new Lazy<>(() -> JsonBindings.nullable(JsonBindings.STRING));
    final Lazy<JsonBinding<Optional<String>>> nullableNonNullDefault = new Lazy<>(() -> JsonBindings.nullable(JsonBindings.STRING));
    final Lazy<JsonBinding<String>> required = new Lazy<>(() -> JsonBindings.STRING);
    final Factory<Defaults> _factory = FACTORY;

    return new JsonBinding<Defaults>() {
      @Override
      public Factory<Defaults> factory() {
        return _factory;
      }

      @Override
      public JsonElement toJson(Defaults _value) {
        JsonObject _result = new JsonObject();
        _result.add("withDefault", withDefault.get().toJson(_value.withDefault));
        _result.add("structWithDefault", structWithDefault.get().toJson(_value.structWithDefault));
        _result.add("nullableNullDefault", nullableNullDefault.get().toJson(_value.nullableNullDefault));
        _result.add("nullableNonNullDefault", nullableNonNullDefault.get().toJson(_value.nullableNonNullDefault));
        _result.add("required", required.get().toJson(_value.required));
        return _result;
      }

      @Override
      public Defaults fromJson(JsonElement _json) {
        JsonObject _obj = JsonBindings.objectFromJson(_json);
        return new Defaults(
          _obj.has("withDefault") && !_obj.get("withDefault").isJsonNull() ? JsonBindings.fieldFromJson(_obj, "withDefault", withDefault.get()) : "abc",
          _obj.has("structWithDefault") && !_obj.get("structWithDefault").isJsonNull() ? JsonBindings.fieldFromJson(_obj, "structWithDefault", structWithDefault.get()) : new Leaf("xyz"),
          _obj.has("nullableNullDefault") ? JsonBindings.fieldFromJson(_obj, "nullableNullDefault", nullableNullDefault.get()) : Optional.<String>empty(),
          _obj.has("nullableNonNullDefault") ? JsonBindings.fieldFromJson(_obj, "nullableNonNullDefault", nullableNonNullDefault.get()) : Optional.<String>of("abc"),
          JsonBindings.fieldFromJson(_obj, "required", required.get())
        );
      }
    };
  }
}
