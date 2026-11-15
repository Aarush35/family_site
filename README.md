# Family Site

Our family's page for Mission 7: the roster, the photos and the mission log.

Live at https://aarush35.github.io/family_site/

## Change the content

Everything on the page is drawn from one file, `js/data.js`.

- **Family name and tagline:** the first two lines.
- **Roster:** one entry per member in `crew`. Only `name` is required. Add `role`, `about`, a `photo` path and `links` when you have them. `{ open: true }` draws an empty slot.
- **Photos:** put the image files in `photos/`, then list them in `photos` with a caption and a date.
- **Missions:** one entry per mission in `missions`. `status` is `started`, `submitted` or `complete`, and the points tally follows from it.

After a change, bump the `?v=` number on the stylesheet and script tags in `index.html` so browsers pick up the new files right away.

## What visitors can play with

- **Control deck** (press `D`): five color circuits, grid motion, floor waves, light runners, ceiling grid, cursor trail, scanlines, sound, plus glow and speed sliders. Choices are remembered on that device.
- **Console** (press `/`): type `help` for the commands.
- **Trail duel** (press `X`): steer a line of light and outlast the opponents.
- Click the arena floor to send a pulse through the grid.

## Files

- `index.html`: the page.
- `css/site.css`: all styling.
- `js/data.js`: the content.
- `js/fx.js`: deck settings, sound, the arena grid and the cursor trail.
- `js/game.js`: trail duel.
- `js/app.js`: draws the page and wires up the deck, console and photo viewer.
- `fonts/`: Michroma, Jura and Share Tech Mono, each under the SIL Open Font License (license files included).

No build step. Any static host can serve the folder as it is.

## Publishing

GitHub Pages serves the `gh-pages` branch. `main` holds the same files, so push every change to both:

```
git push origin main
git push origin main:gh-pages
```
