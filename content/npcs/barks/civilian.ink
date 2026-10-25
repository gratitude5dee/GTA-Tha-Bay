// Two-line exchanges for passers-by. No network call: the sim plays these when the player talks to a pedestrian. The first line is the player's, the second the character's; each knot is one exchange.

=== greeting ===
Excuse me, got a second? # who:player
Sure, if you walk and talk. I am late.
-> END

=== smalltalk ===
How is the neighborhood treating you? # who:player
Hills in every direction, but I have no complaints.
-> END

=== busy ===
Can I ask you something? # who:player
Not now, I am in the middle of three things.
-> END

=== deflect ===
Know anything about the big stuff downtown? # who:player
I mind my own block. Ask someone else.
-> END

=== farewell ===
Thanks, take care. # who:player
You too. Mind the crosswalk.
-> END
