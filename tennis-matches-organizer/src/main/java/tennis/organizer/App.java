package tennis.organizer;
import java.util.*;
import java.util.stream.Collectors;

class Pair {
    private final String p1;
    private final String p2;

    public Pair(String a, String b) {
        if (a.compareTo(b) <= 0) {
          this.p1 = a;
          this.p2 = b;
        }else {
            this.p1 = b;
            this.p2 = a;
        }
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Pair)) return false;
        Pair other = (Pair) o;
        return p1.equals(other.p1) && p2.equals(other.p2) ;
    }

    @Override
    public int hashCode() {
        return Objects.hash(p1, p2);
    }

    @Override
    public String toString() {
        return p1 + "," + p2;
    }
}



public class App 
{
    public static void main( String[] args )
    {
        System.out.println( "Hello World!" );
    }
}
