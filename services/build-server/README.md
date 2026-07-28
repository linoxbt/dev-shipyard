# DevStation Build Server

The backend DevStation's **Program Editor** talks to for Solana Anchor/Rust
**compilation** — plus NFT **image + metadata hosting**. This is the
`VITE_SOLANA_BUILD_API` DevStation points at (there is no reliable public Solana
"compile API", so you run your own — this is it).

## Endpoints

| Method | Path      | Body                                   | Returns |
|--------|-----------|----------------------------------------|---------|
| GET    | `/health` | —                                      | `{ ok, toolchain }` |
| POST   | `/build`  | JSON `{ source, kind }`                | `{ so: base64, idl, name }` or `{ error, log }` |
| POST   | `/upload` | multipart: `image` file + `name`, `symbol`, `description`, `attributes` (JSON) | `{ imageUrl, metadataUrl }` |

- `/build` runs `anchor build` on the submitted Rust source (needs the toolchain — use Docker).
- `/upload` stores the image + a Metaplex metadata JSON and returns short URLs you can use as an on-chain token/NFT `uri` (<200 chars). Works with plain Node — no toolchain required.

## Run it

### Docker (recommended — includes Rust + Solana + Anchor)
```bash
docker build -t devstation-build-server ./services/build-server
docker run -p 8787:8787 -e PUBLIC_URL=https://your-public-url devstation-build-server
```

### Local (needs Rust + Solana CLI + Anchor 0.30 already installed)
```bash
cd services/build-server
npm install
PUBLIC_URL=http://localhost:8787 npm start
```

Installing the toolchain manually:
```bash
curl https://sh.rustup.rs -sSf | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.30.1 && avm use 0.30.1
```

## Point DevStation at it
In the DevStation app's env (`.env.local`):
```
VITE_SOLANA_BUILD_API=http://localhost:8787
```
Then in the Program Editor, **Build & Deploy** compiles via `/build`; the token/NFT
deploy form uploads images + metadata via `/upload`.

## Notes
- The build target is a fixed Anchor crate (`anchor-template/`); the submitted
  source replaces `programs/devprogram/src/lib.rs`.
- The included keypair is for `anchor build`'s provider only — it never signs a
  real transaction (DevStation deploys client-side from the user's wallet).
- Put this behind HTTPS in production; builds are CPU-heavy — add auth/rate limits.
