# The rail of Clouds and its ＋

Once a person has two places or more (their Clouds, their teams' Clouds,
servers they connected by hand), a narrow rail of circles at the window's left
edge switches between them, and ＋ buys another Cloud or adds a server of
their own. With one place there is no rail, and the window looks as before.
Nothing here needs a real MausBot Cloud account, a payment or the Electron app.

## Contract

- The desktop session may list every Cloud of the person's (`clouds`, at most
  20, contract v1 `CloudEntry`). An older Admin sends none, and the session's
  `cloud` and `teams` say everything exactly as before.
- Each Cloud the person owns besides My Cloud is a saved place of its own,
  named and coloured by the Admin, opened like a team's Cloud: the window pairs
  it through the Admin's `pairing` with that Cloud's id and takes only a grant
  for its own address. My Cloud stays the one home.
- The rail's list carries names, colours and states, never an address, and goes
  only to this app's own page and to pages of Clouds MausBot runs that the
  verified session lists. A server's own page gets none; its switcher stays the
  native Server menu. A circle opens only a place main listed, by its id, and
  only from the person's click.
- Buying another Cloud sends the plan, a name and a swatch to the Admin, which
  answers with a checkout this app opens in the browser; the sheet then follows
  the payment and the setup. An Admin that sells one Cloud per account (no
  `clouds`, `canAdd` false, or no such route) is the calm "One Cloud per
  account for now".
- The place on screen tints the top of its sidebar in its colour, faintly
  (`.place-tint`, stronger in dark skins, a thin line with reduced
  transparency, none with forced colours); no colour, no tint. Settings →
  Appearance changes it with the same six swatches: a Cloud's on the Admin
  (`PATCH /api/cloud/desktop/clouds/:id`, its owner or its team's admins; a
  member sees it locked), a server connected by hand on this computer. An
  Admin without that route changes nothing and says so.
- The person's own servers and computers that signed in with their account come
  in the same list (`managed: false`, on a server, with or without an address).
  They are never a Cloud of theirs to pair with or lend to: the rail shows them
  with a server mark, offline with when they were last seen, one already
  connected here as that saved place, one reachable but not connected with its
  pairing steps, and one only reachable on its own network with nothing to
  open.

## Automated fixtures

```sh
node --test electron/cloud-list.node-test.mjs electron/cloud-account-clouds.node-test.mjs electron/cloud-rail.node-test.mjs electron/home-window.node-test.mjs electron/place-look.node-test.mjs
pnpm exec vitest run src/components/PlacesRail.test.ts src/components/cloud-buy/AddCloudFlow.test.ts src/components/PlaceLookCard.test.ts
```

The account tests answer as a loopback Admin, with and without `clouds`. The
rail tests load the production preload and check which page gets the list,
which ids open, and that a circle, ＋, checkout and a colour change act only
from a click. The colour tests check who may change a place's colour and where
it is kept, that nothing is saved when the Admin refuses, and that the tint
follows at once.

## Rendered workflow

```sh
node --experimental-strip-types scripts/verify-cloud-rail.ts --shots .omb-scratch/verify-evidence/cloud-rail
```

It starts a disposable fake-engine server with three bots and the real app in
a Vite preview (`scripts/testing/rail-preview.tsx`), answering the desktop
bridge a hosted Cloud's page gets: six places, one being set up, one that needs
its owner, eleven for the list past eight. A headless Chrome in a throwaway
profile photographs the rail in Advanced and Simple mode (with the place's
tint), the list past eight, ＋'s two choices, the steps for a server of one's
own, the plans, the name and colour of a new Cloud and its setup, the person's
signed-in servers and the steps to connect one, and the colour in Settings for
an admin and for a team member, each in the Daylight and Midnight skins.
`--only rail,look-settings` limits it to some views. Without `--shots` it
prints the preview's address and waits for Ctrl-C.

This is not production qualification: the places and the purchase are the
preview's fixtures, and no Admin, browser checkout or desktop window is
involved.
