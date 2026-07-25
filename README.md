# 暇時間即答PWA

音声で「予定を追加して」「来月どこが空いてる？」と話しかけると、Googleカレンダーへの予定追加、または
暇時間帯の計算・回答を行うPWA。詳細な業務ロジックは [暇時間即答PWA_仕様書.md](./暇時間即答PWA_仕様書.md) を参照。

## 構成

```
gas/src/    GASバックエンド（clasp管理、doPostのみのJSON API）
docs/       PWAフロントエンド（GitHub Pagesが /docs をそのまま配信）
```

GASはHtmlServiceでPWAを配信しない（Service Worker登録・PWAインストール可能性がサンドボックスiframe内では
不安定なため）。PWAは完全に独立した静的サイトとしてGitHub Pagesにホストし、GASはJSON APIとしてのみ機能する。

## 初回セットアップ

### 1. clasp / GASプロジェクト

```bash
npm install -g @google/clasp
clasp login
```

ブラウザでのGoogle認証が必要（対話操作）。

```bash
clasp create --type webapp --title "暇時間即答PWA" --rootDir ./gas/src
```

既存のApps Scriptプロジェクトを使う場合は `clasp clone <scriptId>` を `gas/src` 内で実行してもよい。
`.clasp.json` の `rootDir` が `"./gas/src"` になっていることを確認する。

```bash
clasp push
```

### 2. スクリプトプロパティの設定（Apps Scriptエディタから手動）

`clasp` からは設定できないため、Apps Scriptエディタ（`clasp open`）→ プロジェクト設定 →
スクリプトプロパティで以下を追加する。

| キー | 値 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studioで取得したAPIキー |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite`（2026年5月時点でGA、低レイテンシ・低コスト向け。最新状況は[モデル一覧](https://ai.google.dev/gemini-api/docs/models)で確認） |
| `SHARED_SECRET` | フロントエンドと共有する任意の秘密文字列（推測されにくいランダム文字列を推奨） |

### 3. カレンダー権限の初回認可

Apps Scriptエディタで任意の関数（例: `doGet`）を一度実行し、Calendarスコープの認可（OAuth同意画面）を通す。

### 4. デプロイ

Apps Scriptエディタ → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
- 実行者: 自分
- アクセスできるユーザー: 全員

作成後に表示される `/exec` URLを控える。

**注意**: `clasp push` はコードを更新するだけで、ライブの `/exec` エンドポイントには反映されない。
コード変更のたびに `clasp deploy -i <デプロイID>`（またはエディタのデプロイ管理→編集→新バージョン）が必要。

### 5. フロントエンド設定

```bash
cp docs/config.example.js docs/config.js
```

`docs/config.js` を編集し、`GAS_ENDPOINT`（手順4のURL）と `SHARED_SECRET`（手順2と同じ値）を設定する。
このファイルはコミットされない（`.gitignore` 対象）。

### 6. GitHub Pages

このリポジトリをGitHubにpushし、Settings → Pages で以下を設定する。
- Source: Deploy from a branch
- Branch: `main` / `/docs`

Actionsのビルドは不要（静的ファイルをそのまま配信）。

リポジトリ名は英数字（例: `hima-jikan-pwa`）にすると `https://<user>.github.io/hima-jikan-pwa/` の
ようなクリーンなURLになる。ローカルのフォルダ名（日本語）はそのままで問題ない。

### 7. 動作確認

デプロイされたPages URL（HTTPS）にスマホのChromeでアクセスし、
1. インストールプロンプトが出るか
2. マイクボタンで「〇〇さんと△△時から予定入れて」→ カレンダーに反映されるか
3. マイクボタンで「来月どこが空いてる？」→ 期待した暇時間帯が返るか

を確認する。

## セキュリティ上の注意

Web Appのアクセスは「Anyone」（Googleログイン不要）+ 共有シークレットという構成。実質的な認証ではないため、
`docs/config.js`（実URL・実シークレットを含む）を絶対にコミットしないこと。可能であればリポジトリを
privateにする。

## 開発メモ

- `gas/src/FreeTime.js` はCalendarApp/UrlFetchAppを呼ばない純粋関数群。Apps Scriptエディタ上でアドホックな
  テスト関数を書き、単発休み・連休・月境界またぎ・他予定重複ありのケースを個別に検証できる。
- 空き時間照会は対象期間を前後14日パディングしてから休みブロックを検出する（月境界をまたぐ連休を
  取りこぼさないため）。
- 照会範囲が120日を超える場合は `clarify` を返す（GASの実行時間・クォータへの安全弁）。

