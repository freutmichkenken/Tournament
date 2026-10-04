# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

テニスのダブルス大会向けに、部門ごとのトーナメント表と全部門の試合進行表を作って印刷する静的Webページ。ビルド工程・サーバー・依存パッケージは無く、`index.html` をブラウザで開けば動く。機能の詳細な仕様（同所属の回避、シード、審判の割り当て規則など）は `README.md` に書かれている。

## コマンド

```sh
npm test                                   # 全テスト（node --test test/*.test.js）
node --test --test-name-pattern="名前" test/logic.test.js   # 特定のテストだけ
for f in js/*.js test/*.js; do node --check "$f"; done      # 構文チェック（CIと同じ）
```

CI（`.github/workflows/ci.yml`）は Node 22 で構文チェックと `npm test` を実行する。リンターやフォーマッターは無い。

## 構成

読み込み順は `logic.js` → `render.js` → `app.js`（`index.html` の script タグ）。ES モジュールではなく、各ファイルが IIFE で `window` に公開する。コードは ES5 風（`var`、`function`）で書かれているので、既存の書き方に合わせる。

- `js/logic.js`：画面に依存しない処理。入力の検証、組み合わせの生成（同所属回避・シード配置・BYE）、試合一覧、全部門をまたぐ日程と審判の割り当て（`scheduleEvent`）、保存データの検証（`validateState`）。ブラウザでは `window.TournamentLogic`、Node では `require('../js/logic.js')`。テストはこのファイルだけを対象にする。
- `js/render.js`：トーナメント表を SVG 文字列で描く（`window.TournamentRender`）。
- `js/app.js`：DOM 操作、状態管理、`localStorage`（キー `tournament-maker-v1`）への自動保存、JSON の書き出し・読み込み。状態は `{ version, title, divisions[], tab, schedule }` で、`tab` が `'schedule'` のときは試合進行表を表示する。
- `css/style.css`：画面用と A4 横の印刷用のスタイル。

試合は部門ごとの `matchId` と、部門をまたぐ `matchKey(divisionId, matchId)` で区別する。日程は部門どうしが互いに依存する（空きコートの融通、審判を同じ部門の敗者から出す）ため、部門を1つ変えると日程を作り直す必要がある（`schedule.stale` で管理）。

## 注意点

- 保存データの形を変えるときは `validateState` と読み込み側の互換処理（部門のない旧形式は「男子低学年」に読み込む）を合わせて直す。
- ユーザー向けの文言は日本語で、用語は「チーム」（旧称「ペア」は使わない）。
