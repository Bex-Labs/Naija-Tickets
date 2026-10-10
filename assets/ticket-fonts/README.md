# Ticket email fonts

`noto-sans.json` contains the original Noto Sans Regular and Bold TTF files
encoded as base64. Bundling them as JSON keeps font data in the server bundle
without relying on system fonts or deployment filesystem paths. The email
renderer converts text to vector paths before Sharp rasterises the ticket.

Source: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans
Downloaded 10 October 2026. Redistribution terms are in `LICENSE.txt` (SIL OFL).

Original file SHA-256 checksums:

- NotoSans-Regular.ttf: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`
- NotoSans-Bold.ttf: `c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a`
