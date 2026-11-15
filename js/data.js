/* ============================================================
   The family's content. This is the only file to edit when
   names, photos or missions change.

   Dates are YYYY-MM-DD.
   Mission status is "started", "submitted" or "complete".
   Photo files live in the photos/ folder.
   ============================================================ */
window.SITE = {
  family: "Family Name",
  tagline: "Our crew, our photos, and every mission we've run.",
  updated: "2026-11-14",

  /* One entry per member. Leave role, about and photo empty until you have them.
     { open: true } draws an empty slot. */
  crew: [
    { name: "Aarush Paraskar", role: "", about: "", photo: "", links: [] },
    { open: true },
    { open: true },
    { open: true }
  ],

  /* Gallery photos, in the order they should appear.
     { src: "photos/retreat.jpg", thumb: "photos/retreat-sm.jpg", caption: "Fall retreat", date: "2026-10-03" } */
  photos: [],

  /* Mission log. level is the number of diamonds on the mission card (1 to 3). */
  missions: [
    {
      no: 7,
      title: "Family Site",
      tier: "Moonshot",
      level: 3,
      points: 50,
      status: "started",
      date: "2026-11-14",
      story: "Build and deploy a page for the family: members, photos and a mission log. You're looking at it.",
      photos: []
    }
  ]
};
