# 暗記Foundry

教材を JSON で追加できる、ローカルファーストの暗記学習 PWA です。政経・無機化学・日本国憲法の組み込み教材を初回起動時に端末内へ取り込み、学習記録も同じ端末の IndexedDB に保存します。アカウント、サーバー API、クラウド同期は使用しません。

## 起動

Node.js 18 以上と、`py` コマンドで起動できる Python が必要です。

```powershell
npm run migrate
npm run dev
```

ブラウザーで [http://127.0.0.1:8877/](http://127.0.0.1:8877/) を開きます。Windows では `start-app.bat` または `start-app.ps1` でも同じローカル HTTP サーバーを起動できます。

`file://` で直接開かないでください。ES modules、組み込み教材の `fetch`、Service Worker は localhost または HTTPS が前提です。

## 利用方法

- **一覧・検索**: 政経のフラッシュカード196枚と正誤232問、無機化学26問、憲法の条文104本・穴埋め288問・全文想起104問を閲覧できます。用語・問題文・解説・関連語を検索し、重要度・範囲・学習状況で絞り込めます。
- **検索・お気に入り**: 日本語入力の変換中は画面を再描画せず、確定後に検索します。フラッシュカードの星ボタンでお気に入り登録し、後から「お気に入りのみ」で絞り込めます。
- **憲法の条文穴埋め**: 280空欄を88本の条文カードにまとめたまま一度に表示します。文中の空欄をタップして答えを確認でき、開いたカードを保ったまま絞り込みできます。「すべて開く／閉じる」と、任意の条文だけ・その条文以降から学習する操作にも対応します。8問の基礎穴埋めは分けて表示します。
- **憲法15分模試**: 既存のclozeから30か所をランダム抽出し、条文単位の記述式で15分間に解答します。結果は通常の学習記録へ保存できます。
- **表示中から学習**: 検索・絞り込み後の項目だけを最大20問の学習セッションにできます。
- **おすすめ**: 未学習・誤答・迷い・期限切れを重み付けして最大20問を出題します。
- **弱点**: 誤答、低い定着度、迷い、期限切れを優先します。
- **試験直前**: 重要度 A と弱点・低速回答を中心に、長期記憶の強化を抑えた出題をします。
- **全文想起**: `full-recall` を最大5問、答えを開いて自己評価します。

## クエストとモチベーション機能

無機化学・政経・憲法クエストの元アプリにあったゲーム進行を、3教材共通の進捗へ統合しています。

- 正解、難易度、回答速度、コンボ、モードに応じたXPとレベル・ランク
- 連続学習日、最高コンボ、今日の3ミッション、6種類のバッジ
- 今日のクエスト、冒険、復習ハント、60秒ブリッツ、ボスバトル、エンドレス
- 政経の4択・語句入力・正誤、憲法の意味つなぎ・復元パズル・本番入力・条文連続復元
- 無機化学の単元、政経の4範囲、憲法の13章を使ったエリアマップ
- ボス戦のPlayer/Boss HP、10分制限、60%で★1・80%でクリア★2・90%で★3の評価
- 誤答を3問以上あとに再出題する復習キューと、ボス撃破記録の永続保存

XP、ランク、連続学習日、ボス評価は `meta.game` としてIndexedDBへ保存され、完全Backup/Restoreにも含まれます。問題ごとのMemory Engineは従来どおり独立して更新されます。

入力・穴埋めの正誤判定は、全半角、大小文字、空白、一部の句読点・括弧を正規化して比較します。部分一致は正解にしません。無機化学の `[[chem:...]]` は化学表記用の表示マークアップであり、HTML としては実行されません。

## 組み込み教材

`npm run migrate` は外部の既存教材を読み取り、`data/builtin-packs.json` を再生成します。原本は変更しません。

| Pack | 教材内容 | 問題数 |
| --- | --- | ---: |
| `seikei-memorization` | 政経の概念 resource 196件と問題 | 入力196、正誤232（計428問） |
| `inorganic-chemistry` | 無機化学 | 26 |
| `constitution-quest` | 日本国憲法 | 空欄280、要約空欄8、全文想起104（計392） |

憲法 pack には条文104本、章13件、ステージ13件を resource として格納します。条文の `segments`、空欄の原文、許容解答、出典メタデータを保持します。

## PWA と保存場所

- 静的アプリ本体は `index.html`、`styles.css`、`src/`、`data/` です。
- `sw.js` はアプリシェルと組み込み教材をキャッシュし、画面遷移は network-first、それ以外の同一オリジン GET は stale-while-revalidate で扱います。
- IndexedDB の database 名は `memory-foundry`、object store は `meta`、`packs`、`progress`、`history` です。
- 初回起動時は `data/builtin-packs.json` を読み、未導入の組み込み pack を保存します。内容バージョンが変わった組み込み pack は、ユーザー編集済みでない場合にだけ更新します。

ブラウザーのサイトデータを削除すると、端末内の教材・進捗・履歴も消えます。先に管理画面の **Backup** をダウンロードしてください。

## 教材の追加と管理

管理画面から Pack JSON を import、編集、複製、Archive、Restore、export できます。保存前に schema と resource 参照を検証します。

同じ pack ID を置換する場合、既存の学習記録が参照する exercise ID を候補から削除すると置換できません。IDを変えて複製するか、既存 exercise ID を維持してください。Archive は教材・進捗・履歴を保持したまま通常出題から外します。完全削除は関連する進捗と履歴を削除するため、先に Backup を取ってください。

詳細な JSON 仕様と拡張手順は [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)、内部構成は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## Backup / Restore の安全性

Backup は packs、progress、history、設定を `memory-foundry-backup` JSON として出力します。Restore は確認画面を出し、次を検証してから一つの IndexedDB transaction で全置換します。

- schema version と backup type
- pack / resource / exercise の ID 重複と exercise payload
- progress の `packId::exerciseId` key、pack と exercise の参照、数値・時刻
- history の ID、pack と exercise の参照、問題形式、正誤、時刻

有効な Restore は現在の教材・進捗・履歴を置き換えます。マージではありません。

## 開発・検証

```powershell
npm run migrate  # legacy source -> data/builtin-packs.json
npm test         # node:test: core、migration、renderer
npm run verify   # 静的ファイル検査
npm run build    # migrate -> verify -> test
```

`package.json` の build は静的検査を必須工程として呼び出します。テスト成功は Node 上の契約・移行・描画検証であり、実ブラウザーでの PWA 導入・Service Worker・IndexedDB の動作証明ではありません。リリース前には localhost でその画面も確認します。

## Push 前チェック

1. `npm run build` を成功させる。
2. localhost で起動し、3 pack の表示、1問の回答保存、再読み込み後の進捗保持、Backup download を確認する。
3. DevTools の Application で Service Worker と IndexedDB `memory-foundry` を確認する。初回 Service Worker 導入後は再読み込みする。
4. `git diff --check` と `git status --short` で意図しない差分や資格情報がないことを確認する。
5. `data/builtin-packs.json` を手編集した場合も `npm run migrate` を実行して移行源と検証結果を揃える。
