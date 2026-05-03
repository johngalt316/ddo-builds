# DDO Builds

A hobby build calculator for **Dungeons and Dragons Online** (DDO). Plan your character build — race, multiclass splits, ability scores, feats, skills, and enhancement trees — then share it with a URL.

**Live demo:** deploy your own via Docker or AWS App Runner (see below).

---

## Features

- **Multiclass support** — model DDO's 3-class split system with accurate BAB, saves, and hit points
- **32-point buy** — allocate ability scores with real-time cost feedback and racial bonus preview
- **Real DDO data** — feats, classes, races, and enhancement trees loaded from the actual DDOBuilder data files (430+ feats, 28 classes, 28 races, 112 enhancement trees)
- **Share builds** — the full build is encoded in the URL via lz-string; paste and share, no account required
- **Self-hostable** via Docker Compose or any static file server
- **AWS-ready** — Docker image deployable to App Runner, ECS, or any container service

---

## Getting Started

### Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

### Production preview (Docker)

```bash
docker compose up --build    # http://localhost:3000
```

The Docker image is ~30MB (Nginx + static bundle). Nginx is configured with SPA fallback, aggressive cache headers for hashed assets, and security headers.

### Run checks

```bash
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm run test         # Vitest unit tests (engine calculation functions)
```

---

## Project Structure

```
src/
├── components/      # React UI components (build panels, layout)
├── data/            # Minimal stub JSON (superseded by public/data XML at runtime)
├── engine/          # Pure TypeScript calculation functions (BAB, saves, HP, skills)
├── hooks/           # React hooks (useBuild, useGameData, useShareUrl, useLocalStorage)
├── pages/           # Route-level pages (Home, BuildEditor, NotFound)
├── store/           # Zustand stores (buildStore, gameDataStore)
├── types/           # TypeScript types (build.ts, gameData.ts, ddoData.ts)
└── utils/           # Utilities (ddoXmlParser, compression, validation)

public/
├── data/            # DDO game data XML files (see Data & Credits below)
│   ├── Feats.xml    # 430+ feat definitions
│   ├── Spells.xml   # Spell database
│   ├── Classes/     # 28 class definition XML files
│   ├── Races/       # 28 race definition XML files
│   ├── EnhancementTrees/  # 112 enhancement tree XML files
│   ├── Augments/    # 31 augment set XML files
│   └── FiligreeSets/# 65 filigree set XML files
└── assets/
    └── images/      # ~6,000 game icons (PNG)
        ├── ClassImages/
        ├── FeatImages/
        ├── EnhancementImages/
        ├── SpellImages/
        └── ...
```

---

## AWS Deployment

The recommended hosting path for this hobby project is **AWS App Runner** (~$5/month for a 0.25vCPU / 0.5GB container).

### One-time setup

```bash
# Create ECR repository
aws ecr create-repository --repository-name ddo-builds --region us-east-1

# Create App Runner service pointing at your ECR image (port 80)
# Enable "automatic deployment" so pushes to ECR trigger a redeploy
```

### Deploy

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t ddo-builds .
docker tag  ddo-builds:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ddo-builds:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ddo-builds:latest
```

### Automated via GitHub Actions

See `.github/workflows/deploy.yml`. Replace `<ACCOUNT_ID>` and `<SERVICE_ID>` with your values, then create an IAM role with a GitHub OIDC trust policy (no long-lived secrets needed).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript 5 + Vite 6 |
| State | Zustand 5 |
| Routing | React Router 7 |
| Build sharing | lz-string URL hash |
| Serving | Nginx 1.27-alpine |
| Container | Docker multi-stage build (~30MB image) |
| AWS | App Runner |
| CI | GitHub Actions (lint + typecheck + test + Docker build) |

---

## Data & Credits

The game data files in `public/data/` and the image assets in `public/assets/images/` are sourced from the **DDOBuilder** project by **Maetrim**:

> **DDOBuilderV2** — https://github.com/Maetrim/DDOBuilderV2
>
> A Windows desktop application (C++/MFC) for planning DDO character builds.
> The data files (XML) and image assets (PNG) in this repository are taken
> directly from that project's `Output/DataFiles/` directory.

The data includes:
- **Feats.xml** — 430+ feat definitions with prerequisites and effects
- **Classes/** — 28 class files (Fighter, Wizard, Rogue, etc.) with BAB tables, save progressions, automatic feats, and feat slots
- **Races/** — 28 race files with build points, racial feats, and past life feats
- **EnhancementTrees/** — 112 enhancement tree files (class trees, race trees, epic destinies, universal trees)
- **Augments/, FiligreeSets/** — augment and filigree set definitions
- **Spells.xml, Stances.xml, SetBonuses.xml, ItemBuffs.xml** — additional game data

**DDO (Dungeons and Dragons Online)** is © 2024 Standing Stone Games. All game content, names, and assets are the property of their respective owners. This project is a fan-made hobby tool and is not affiliated with or endorsed by Standing Stone Games or Daybreak Game Company.

---

## Contributing / Roadmap

This is a personal hobby project. Planned features:

- [ ] Feat browser with prerequisite validation against current build
- [ ] Skill rank allocator with class skill detection
- [ ] Enhancement tree grid (visual AP budget tracker with tier unlocks)
- [ ] Spell selection for spellcaster classes
- [ ] Build import from DDOBuilder `.DDOBuild` files
- [ ] Mobile-responsive layout

Pull requests are welcome for bug fixes and data corrections.
