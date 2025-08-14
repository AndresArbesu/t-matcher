package tennis.organizer;
import java.util.*;
import java.util.stream.Collectors;

class Pair {
    private final String player1;
    private final String player2;

    public Pair(String a, String b) {
        if (a.compareTo(b) <= 0) {
          this.player1 = a;
          this.player2 = b;
        }else {
            this.player1 = b;
            this.player2 = a;
        }
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Pair)) return false;
        Pair other = (Pair) o;
        return player1.equals(other.player1) && player2.equals(other.player2) ;
    }

    @Override
    public int hashCode() {
        return Objects.hash(player1, player2);
    }

    @Override
    public String toString() {
        return player1 + "," + player2;
    }
}

class Match {
    private final Pair pair1;
    private final Pair pair2;

    public Match(Pair a, Pair b) {
        if (a.toString().compareTo(b.toString()) <= 0) {
            this.pair1 = a;
            this.pair2 = b;
        } else {
            this.pair1 = b;
            this.pair2 = a;
        }
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Match)) return false;
        Match other = (Match) o;
        return pair1.equals(other.pair1) && pair2.equals(other.pair2) ;
    }

    @Override
    public int hashCode() {
        return Objects.hash(pair1, pair2);
    }

    @Override
    public String toString() {
        return pair1 + "," + pair2;
    }
}

class Arrangement {
    private final List<Match> matches;

    public Arrangement(List<Match> matches) {
        this.matches = new ArrayList<>(matches);
        this.matches.sort(Comparator.comparing(Match::toString));
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Arrangement)) return false;
        Arrangement other = (Arrangement) o;
        return matches.equals(other.matches);
    }

    @Override
    public int hashCode() {
        return matches.hashCode();
    }

    @Override
    public String toString() {
        return matches.stream().map(Object::toString).collect(Collectors.joining("|"));
    }


}

@FunctionalInterface
interface ArrangementRule {
    boolean test(Arrangement arrangement);
}

public class TennisArrangements {

    public static List<Arrangement> generateArrangements(List<String> players) {
        Set<Arrangement> arrangements = new HashSet<>();
        generateRecursive(players, new ArrayList<>(), arrangements);
        return new ArrayList<>(arrangements);
    }

    private static void generateRecursive(List<String> remaining, List<Match> current, Set<Arrangement> arrangements) {
        if (remaining.isEmpty()) {
            arrangements.add(new Arrangement(current));
            return;
        }
        if (current.size() == 3) return;

        // Pick first pair
        for (int i = 1; i < remaining.size(); i++) {
            Pair p1 = new Pair(remaining.get(0), remaining.get(i));

            // Remaining players after first pair
            List<String> afterP1 = new ArrayList<>(remaining);
            afterP1.remove(0);
            afterP1.remove(i - 1);

            // Pick second pair
            for (int j = 1; j < afterP1.size(); j++) {
                Pair p2 = new Pair(afterP1.get(0), afterP1.get(j));

                List<String> afterP2 = new ArrayList<>(afterP1);
                afterP2.remove(0);
                afterP2.remove(j - 1);

                Match match = new Match(p1, p2);
                List<Match> newCurrent = new ArrayList<>(current);
                newCurrent.add(match);

                generateRecursive(afterP2, newCurrent, arrangements);
            }
        }
    }

    public static List<Arrangement> filterArrangements(List<Arrangement> arrangements, List<ArrangementRule> rules) {
        return arrangements.stream()
                .filter(arr -> rules.stream().allMatch(r -> r.test(arr)))
                .collect(Collectors.toList());
    }

    public static void main(String[] args) {
        List<String> players = Arrays.asList("A", "B", "C", "D","F","G","H","I","J","K","L","M");

        System.out.println("Generating arrangements...");
        List<Arrangement> all = generateArrangements(players);

        System.out.println("Total arrangements before filtering: " + all.size());

        // Example rule: No player should appear twice in a match (always true here)
        List<ArrangementRule> rules = new ArrayList<>();
        rules.add(arr -> true);

        List<Arrangement> filtered = filterArrangements(all, rules);
        System.out.println("Total arrangements after filtering: " + filtered.size());

        System.out.println("Sample arrangements:");
        filtered.stream().limit(5).forEach(System.out::println);
    }
}
