# アーキテクチャ

## 全体像

暗記Foundry はビルド工程を必要としない静的 ES module PWA です。ブラウザーが localhost または HTTPS 上で `index.html` を読み、`src/app.js` が IndexedDB と組み込み教材 JSON を初期化します。

```text
index.html
  └─ src/app.js ─┬─ src/core.js ───── src/exercise-types.js
                 ├─ src/exercise-registry.js
                 ├─ src/storage.js ── IndexedDB (memory-foundry)
                 └─ data/builtin-packs.json

sw.js ── Cache Storage (アプリシェルと組み込み教材)
tools/migrate-legacy.mjs ── data/builtin-packs.json
```

## 起動と組み込み教材の同期

1. `app.js` が `openStorage()` で IndexedDB を開き、全 store を読み込みます。
2. `data/builtin-packs.json` を `cache: "no-cache"` で取得します。既存の pack がある場合は、この取得に失敗しても保存済み教材で起動できます。初回で取得できない場合は起動エラーです。
3. `syncBuiltinPacks()` が各 pack を `validatePack()` で検証します。
4. 未導入 pack は保存し、`metadata.contentVersion` が変わった pack は `userEdited` でないときだけ更新します。更新時も Archive 状態と初回作成時刻を保持します。
5. 画面を描画し、対応環境では `sw.js` を登録します。

この同期はユーザー編集済み教材を上書きしないため、組み込み教材の修正は `metadata.contentVersion` を上げ、移行・テストを通してから行います。

## 学習と記憶モデル

`core.js` は採点、進捗 identity、復習キュー、間隔の更新を担当します。進捗 key は常に `packId::exerciseId` です。

- 回答ごとに progress と history を単一の IndexedDB transaction で書き込みます。
- `updateMemory()` は interaction type の recall weight、正誤、迷い、ヒント、回答時間、直前モード、日をまたいだ正解を使います。
- 誤答は約10分後に復習対象になり、同日内の回復は長期定着を過大評価しません。
- セッション内の誤答は、3つ以上の別問題を挟める場合のみ再出題します。
- 初回のおすすめ学習では、入力・穴埋めの一部を十分な選択肢がある場合だけ認識問題として表示します。保存される学習対象 ID は元の exercise ID のままです。

`exercise-types.js` は type ごとの validation、採点、recall weight を定義し、`exercise-registry.js` は描画とユーザー入力の取得を定義します。`app.js` はこれらを組み合わせ、回答後の評価ボタンと画面遷移を制御します。

## データの境界

| 層 | 所有する内容 |
| --- | --- |
| `data/builtin-packs.json` | 配布する組み込み教材の bundle。読み取り元ではなく生成物。 |
| IndexedDB `packs` | 組み込み教材の導入済みコピーとユーザー作成・import教材。 |
| IndexedDB `progress` | exercise ごとの学習状態。key は `packId::exerciseId`。 |
| IndexedDB `history` | 回答の監査・表示用履歴。 |
| Cache Storage | アプリシェル・教材のオフライン用キャッシュ。学習記録は入れない。 |

Pack の内容と progress の整合性は exercise ID に依存します。学習済み exercise を含む pack を編集・import 置換する場合、IDを消す操作は UI 側で拒否します。

## PWA とオフライン

Service Worker は install 時にアプリシェルを cache へ追加し、activate 時に旧 cache を削除します。同一オリジン GET では、navigation は network-first、その他の静的リソースは stale-while-revalidate です。Service Worker の cache 名やプリキャッシュ一覧を変更したときは、`sw.js` の更新と localhost の再確認をセットで行ってください。

Service Worker は `file://` では動作しません。ローカル確認には `npm run dev` または `start-app.ps1` を使います。

## 移行器

`tools/migrate-legacy.mjs` は次の原本を読み取り、3 pack を生成します。

- `政経/memorization_game/index.html`
- `無機化学/data/questions.json`
- `政経/constitution-quest/data/*.json`

移行器は `validatePack()`、ID重複、resource参照、憲法の blank と `segments` の1対1対応を検証し、件数が期待値と異なれば exit code 1 で停止します。原本を編集しません。

## セキュリティと信頼境界

- JSON は import、editor保存、backup restore の前に検証します。
- rich text は HTML エスケープしたうえで `[[chem:...]]` のみを専用 span として描画します。
- pack import の同ID置換は、既存進捗が参照する exercise ID を残す場合に限ります。
- Backup Restore は全参照の検証後に transaction で置換します。検証失敗時は書き込みません。

これは端末内保存のアプリです。ブラウザーのプロファイル削除・ストレージ初期化に対する自動復旧はありません。外部保存が必要なら Backup JSON を利用してください。


