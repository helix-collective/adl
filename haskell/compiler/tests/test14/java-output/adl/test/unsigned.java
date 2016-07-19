package adl.test;

import org.adl.runtime.Factories;
import org.adl.runtime.Factory;

public class unsigned {

  private Disc disc;
  private Object value;

  public enum Disc {
    NULL_
  }

  public static unsigned null_(Void v) {
    return new unsigned(Disc.NULL_,v);
  }

  public unsigned() {
    this.disc = Disc.NULL_;
    this.value = null;
  }

  public unsigned(unsigned other) {
    this.disc = other.disc;
    switch (other.disc) {
      case NULL_:
        this.value = (Void) other.value;
        break;
    }
  }

  private unsigned(Disc disc, Object value) {
    this.disc = disc;
    this.value = value;
  }

  public Disc getDisc() {
    return disc;
  }

  public Void getNull() {
    if (disc == Disc.NULL_) {
      return cast(value);
    }
    throw new IllegalStateException();
  }

  public void setNull(Void v) {
    this.value = v;
    this.disc = Disc.NULL_;
  }

  public boolean equals(unsigned other) {
    return disc == other.disc && value.equals(other.value);
  }

  public int hashCode() {
    return disc.hashCode() * 37 + value.hashCode();
  }

  @SuppressWarnings("unchecked")
  private static <T> T cast(final Object o) {
    return (T)o;
  }

  public static Factory<unsigned> factory = new Factory<unsigned>() {
    public unsigned create() {
      return new unsigned();
    }
    public unsigned create(unsigned other) {
      return new unsigned(other);
    }
  };
}