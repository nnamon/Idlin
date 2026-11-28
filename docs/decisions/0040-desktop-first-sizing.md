# 0040: Sizes are set for a desktop viewer at 1920

Date: 2026-11-28. Decided on #440, open to veto. The operator found the name
tags far too big and asked for the game to be sized for a desktop viewer, not
a phone. The viewer watches on a desktop at 1920 by 1080, and every
readability check (the art bible, the watch rubric, the look pass, the slice's
build table) is made on the 1920 frame. Nothing has to read at 640 any more.

| Decision                                                                                                                                                                                             | Rejected                                                                                                            | Why                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text, numbers and marks are sized for a desktop viewer at 1920. Name tags are 20 px, a called tag 24 px, and nothing is lettered under 20 px; [art.md](../art.md), section 11, has the scale (#441). | Phone first: every tag, number and corner sized to read in a 640-wide window, the frame averaged down three to one. | At 640 sizes a tag was 30 or 36 px on the 1920 frame, heavier than the citizen it named, and a called tag was 48 px. The operator watches on a desktop and asked for that seat. A called citizen still gets a highlight and a ring at its feet to be found. |
| The capture tool keeps writing its 640 stills and `storyboard-640`.                                                                                                                                  | Removing them in the same change.                                                                                   | This is a docs change. The stills cost little and nothing is judged on them now; dropping them is a change to the tool and can be its own issue.                                                                                                            |

**Superseded.** The lettering sizes in [0038](0038-renderer-scale-and-the-siege.md)
(a 30 px tag, 36 px with 20 or fewer out, a 48 px called tag, dens at 36 px,
a 5 px halo) and its "At 640" and "Reads at 640" columns. The "a viewer at 640"
in [0035](0035-seven-phases-a-shield-and-a-city-that-grows.md) and the 640
window in [0003](0003-frame-and-map-size.md) are read at 1920 from now on.
Those notes are left as they were written.
