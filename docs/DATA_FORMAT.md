# 教材 Pack JSON 形式

## Pack の契約

教材を import する最小単位は 1つの Pack object です。組み込み教材 bundle は `packs` 配列にこの object を入れます。実際の受理条件は `src/core.js` の `validatePack()` と `src/exercise-types.js` が正です。

```json
{
  "schemaVersion": 1,
  "type": "memory-pack",
  "id": "world-history-basic",
  "title": "世界史 基礎",
  "subject": { "id": "world-history", "name": "世界史" },
  "status": "active",
  "createdAt": "2026-08-20T00:00:00.000Z",
  "updatedAt": "2026-08-20T00:00:00.000Z",
  "resources": [],
  "exercises": [],
  "metadata": { "contentVersion": "1", "userEdited": true }
}
```

必須項目は `schemaVersion: 1`、`type: "memory-pack"`、空でない `id`・`title`、`subject.id`・`subject.name`、`status`（`active` または `archived`）、`resources` 配列、`exercises` 配列です。追加のメタデータは保持できます。

## Resource

resource は資料・概念・条文などの出典単位です。

```json
{
  "id": "concept:magna-carta",
  "kind": "concept",
  "title": "マグナ・カルタ",
  "text": "王権を制限した1215年の文書",
  "source": { "sourcePath": "sources/history.json", "legacyId": "magna-carta" }
}
```

必須なのは空でない `id` と `kind` です。pack 内で resource ID は一意にします。exercise の `resourceId` を使う場合、その ID は同じ pack の resource に存在しなければなりません。

## Exercise 共通項目

```json
{
  "id": "concept-input:magna-carta",
  "resourceId": "concept:magna-carta",
  "type": "text-input",
  "importance": "A",
  "payload": {},
  "source": { "legacyId": "magna-carta" },
  "metadata": { "topic": "中世ヨーロッパ" }
}
```

`id`、`type`、`payload` は必須です。exercise ID は pack 内で一意にします。`importance` は任意ですが、`A`、`B`、`C` を使うと復習の優先度を付けられます。`source`、`metadata`、`resourceId` は任意です。

## 現在の問題形式

| type | 必須 payload | 採点・表示 |
| --- | --- | --- |
| `single-choice` | `prompt`、2件以上の `options[{id,text}]`、`correctOptionId` | 1つ選択 |
| `multiple-choice` | `prompt`、2件以上の `options`、1件以上の `correctOptionIds` | 複数選択。正解集合が完全一致したときのみ正解 |
| `true-false` | `statement`、boolean の `answer` | 正しい / 誤り |
| `text-input` | `prompt`、1件以上の `acceptedAnswers` | 正規化した完全一致 |
| `cloze` | `before`、`answer`、`after`、1件以上の `acceptedAnswers` | 文脈付き入力。`answer` は正答表示にも使う |
| `self-grade` | `prompt`、`answer` | 答えを開き、本人が評価 |
| `full-recall` | `prompt`、1件以上の `acceptedAnswers` | 答えを開き、本人が評価 |

### 例: 単一選択

```json
{
  "id": "q:capital",
  "type": "single-choice",
  "importance": "B",
  "payload": {
    "prompt": "フランスの首都は？",
    "options": [
      { "id": "a", "text": "パリ" },
      { "id": "b", "text": "リヨン" }
    ],
    "correctOptionId": "a",
    "explanation": "パリはフランスの首都です。"
  }
}
```

### 例: 穴埋め

```json
{
  "id": "q:cloze-1",
  "type": "cloze",
  "payload": {
    "before": "日本国憲法は国の",
    "answer": "最高法規",
    "after": "である。",
    "acceptedAnswers": ["最高法規"],
    "explanation": "表記ゆれを許す場合は acceptedAnswers に明示します。"
  }
}
```

`acceptedAnswers` は正答そのものと、意図して許容する表記だけを列挙します。正規化は空白・全半角・一部記号を吸収しますが、語句の部分一致や曖昧一致は行いません。

## 組み込み教材 bundle

`data/builtin-packs.json` は次の外側形式です。

```json
{
  "schemaVersion": 1,
  "type": "builtin-memory-packs",
  "generatedAt": "2026-08-20T00:00:00.000Z",
  "packs": [/* Pack objects */]
}
```

各組み込み pack の `metadata.contentVersion` は同期判断に使います。組み込み教材を変更したら、この値を上げます。`metadata.userEdited: true` の端末内 pack は同じ ID の組み込み更新で置き換えません。

## 新教材を追加する方法

1. 上の Pack schema で JSON を作る。IDは将来も変えない名前空間付きの文字列にする。
2. `resourceId` を使うなら、resource を先に定義する。
3. 管理画面の **教材をimport** から読み込み、preview の validation を通す。
4. 少なくとも各問題形式を1問ずつ実際に回答し、export と Backup を確認する。
5. 組み込み教材として配布する場合は移行器または bundle を更新し、`metadata.contentVersion` とテストの期待件数を更新する。

学習を開始した pack を更新する場合、progress が参照する exercise ID を削除してはいけません。内容を大きく変える教材は新しい pack ID で配布する方が安全です。

## 新しい問題形式を追加する方法

schema の `type` を増やすだけでは動きません。次の実装を同じ変更で追加します。

1. `src/exercise-types.js` の `EXERCISE_TYPES` に type 名、`recallWeight`、`validate(payload, path, add)`、`grade(payload, response)` を追加する。
2. `src/exercise-registry.js` に同じ type の `label`、`renderPrompt`、`renderAnswer`、`readResponse`、`grade` を追加する。
3. `src/core.js` の validation と記憶更新は type registry を参照するため、type definition の追加後に新 type を受理する。
4. `history.interactionType` も type registry で検証されるため、Backup/Restore 用のテストを追加する。
5. renderer、採点、入力、アクセシビリティ、復習の各テストを追加する。

新しい type は import 前 validation、画面描画、回答記録、Backup Restore の全経路を通して初めて対応済みです。

## Backup 形式

```json
{
  "schemaVersion": 1,
  "type": "memory-foundry-backup",
  "exportedAt": "2026-08-20T00:00:00.000Z",
  "metadata": { "packCount": 1, "progressCount": 2, "historyCount": 2 },
  "meta": {},
  "packs": [/* Pack */],
  "progress": [/* progress */],
  "history": [/* history */]
}
```

Restore は pack の正当性に加えて、progress の key と `packId`/`exerciseId` の一致、参照先 exercise の存在、履歴の ID・参照・type・時刻・正誤を検証します。検証に失敗した JSON は Restore できません。


