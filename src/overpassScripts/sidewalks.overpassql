﻿/*
This has been generated by the overpass-turbo wizard.
The original search was:
“highway=footway or crossing=* or footway=*”
*/
[out:json][timeout:180];
// gather results
(
  // query part for: “highway=footway”
  way["highway"="footway"]({{bbox}});
  relation["highway"="footway"]({{bbox}});

  // query part for: “crossing=*”
  way["crossing"]({{bbox}});
  relation["crossing"]({{bbox}});
  
  // query part for: “footway=*”
  way["footway"]({{bbox}});
  relation["footway"]({{bbox}});
  
  // query part for: “sidewalk=both”
  way["sidewalk"="both"]({{bbox}});
  relation["sidewalk"="both"]({{bbox}});
  
  // query part for: “sidewalk=left”
  way["sidewalk"="left"]({{bbox}});
  relation["sidewalk"="left"]({{bbox}});
  
  // query part for: “sidewalk=right”
  way["sidewalk"="right"]({{bbox}});
  relation["sidewalk"="right"]({{bbox}});
);

// print results
out body;
>;
out skel qt;