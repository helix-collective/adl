/* @generated from adl module test31 */

package adl.test31;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
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

public class Leaf {

  /* Members */

  private String text;

  /* Constructors */

  public Leaf(String text) {
    this.text = Objects.requireNonNull(text);
  }

  public Leaf() {
    this.text = defText();
  }

  public Leaf(Leaf other) {
    this.text = other.text;
  }

  /* Field defaults */

  public static String defText() {
    return "xyz";
  }

  /* Accessors and mutators */

  public String getText() {
    return text;
  }

  public Leaf setText(String text) {
    this.text = Objects.requireNonNull(text);
    return this;
  }

  /* Object level helpers */

  @Override
  public boolean equals(Object other0) {
    if (!(other0 instanceof Leaf)) {
      return false;
    }
    Leaf other = (Leaf) other0;
    return
      text.equals(other.text);
  }

  @Override
  public int hashCode() {
    int _result = 1;
    _result = _result * 37 + text.hashCode();
    return _result;
  }

  /* Factory for construction of generic values */

  public static final Factory<Leaf> FACTORY = new Factory<Leaf>() {
    @Override
    public Leaf create(Leaf other) {
      return new Leaf(other);
    }

    @Override
    public TypeExpr typeExpr() {
      ScopedName scopedName = new ScopedName("test31", "Leaf");
      ArrayList<TypeExpr> params = new ArrayList<>();
      return new TypeExpr(TypeRef.reference(scopedName), params);
    }
    @Override
    public JsonBinding<Leaf> jsonBinding() {
      return Leaf.jsonBinding();
    }
  };

  /* Json serialization */

  public static JsonBinding<Leaf> jsonBinding() {
    final Lazy<JsonBinding<String>> text = new Lazy<>(() -> JsonBindings.STRING);
    final Factory<Leaf> _factory = FACTORY;

    return new JsonBinding<Leaf>() {
      @Override
      public Factory<Leaf> factory() {
        return _factory;
      }

      @Override
      public JsonElement toJson(Leaf _value) {
        JsonObject _result = new JsonObject();
        _result.add("text", text.get().toJson(_value.text));
        return _result;
      }

      @Override
      public Leaf fromJson(JsonElement _json) {
        JsonObject _obj = JsonBindings.objectFromJson(_json);
        return new Leaf(
          _obj.has("text") && !_obj.get("text").isJsonNull() ? JsonBindings.fieldFromJson(_obj, "text", text.get()) : "xyz"
        );
      }
    };
  }
}
