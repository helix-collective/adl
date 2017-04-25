/* Code generated from adl module test2 */

package adl.test2;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.adl.runtime.Factories;
import org.adl.runtime.Factory;
import org.adl.runtime.JsonBinding;
import org.adl.runtime.JsonBindings;
import org.adl.runtime.Lazy;
import java.util.Objects;

public class S4<T> {

  /* Members */

  private S3<String> f1;
  private S3<T> f2;

  /* Constructors */

  public S4(S3<String> f1, S3<T> f2) {
    this.f1 = Objects.requireNonNull(f1);
    this.f2 = Objects.requireNonNull(f2);
  }

  /* Accessors and mutators */

  public S3<String> getF1() {
    return f1;
  }

  public void setF1(S3<String> f1) {
    this.f1 = Objects.requireNonNull(f1);
  }

  public S3<T> getF2() {
    return f2;
  }

  public void setF2(S3<T> f2) {
    this.f2 = Objects.requireNonNull(f2);
  }

  /* Object level helpers */

  @Override
  public boolean equals(Object other0) {
    if (!(other0 instanceof S4)) {
      return false;
    }
    S4 other = (S4) other0;
    return
      f1.equals(other.f1) &&
      f2.equals(other.f2);
  }

  @Override
  public int hashCode() {
    int _result = 1;
    _result = _result * 37 + f1.hashCode();
    _result = _result * 37 + f2.hashCode();
    return _result;
  }

  /* Factory for construction of generic values */

  public static <T> Factory<S4<T>> factory(Factory<T> factoryT) {
    return new Factory<S4<T>>() {
      final Lazy<Factory<S3<String>>> f1 = new Lazy<>(() -> S3.factory(Factories.STRING));
      final Lazy<Factory<S3<T>>> f2 = new Lazy<>(() -> S3.factory(factoryT));

      public S4<T> create() {
        return new S4<T>(
          f1.get().create(),
          f2.get().create()
          );
      }

      public S4<T> create(S4<T> other) {
        return new S4<T>(
          f1.get().create(other.getF1()),
          f2.get().create(other.getF2())
          );
      }
    };
  }

  /* Json serialization */

  public static<T> JsonBinding<S4<T>> jsonBinding(JsonBinding<T> bindingT) {
    final Lazy<JsonBinding<S3<String>>> f1 = new Lazy<>(() -> S3.jsonBinding(JsonBindings.STRING));
    final Lazy<JsonBinding<S3<T>>> f2 = new Lazy<>(() -> S3.jsonBinding(bindingT));
    final Factory<T> factoryT = bindingT.factory();
    final Factory<S4<T>> _factory = factory(bindingT.factory());

    return new JsonBinding<S4<T>>() {
      public Factory<S4<T>> factory() {
        return _factory;
      }

      public JsonElement toJson(S4<T> _value) {
        JsonObject _result = new JsonObject();
        _result.add("f1", f1.get().toJson(_value.f1));
        _result.add("f2", f2.get().toJson(_value.f2));
        return _result;
      }

      public S4<T> fromJson(JsonElement _json) {
        JsonObject _obj = JsonBindings.objectFromJson(_json);
        return new S4<T>(
          JsonBindings.fieldFromJson(_obj, "f1", f1.get()),
          JsonBindings.fieldFromJson(_obj, "f2", f2.get())
        );
      }
    };
  }
}
