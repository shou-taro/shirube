/**
 * Landing-page copy for both locales, plus the demo's scripted questions.
 *
 * English is British; Japanese reads naturally rather than as a translation of the English.
 * The two are written to stand on their own, so they are not literal mirrors of each other.
 */

export type Lang = 'en' | 'ja'

export interface Strings {
  htmlLang: string
  meta: { title: string; description: string }
  nav: { docs: string; github: string; getStarted: string }
  hero: {
    /** Status pill (e.g. "Beta"). */
    badge: string
    /** Open-source pill, shown beside the status. */
    badgeOss: string
    title: string
    lede: string
    ctaPrimary: string
    ctaSecondary: string
    installNote: string
  }
  demo: {
    badge: string
    title: string
    note: string
    openTab: string
    loading: string
  }
  /** AI navigator spotlight row. */
  ai: {
    eyebrow: string
    title: string
    desc: string
    /** Clear sample questions; [0] is shown answered in the visual, the rest as chips. */
    examples: string[]
    /** Label above the example-question chips — makes clear these are examples. */
    examplesLabel: string
    note: string
  }
  /** Explorer row. */
  explore: {
    eyebrow: string
    title: string
    desc: string
  }
  /** Route-trace row. */
  route: {
    eyebrow: string
    title: string
    desc: string
  }
  /** Draw-your-own-relationship row. */
  draw: {
    eyebrow: string
    title: string
    desc: string
  }
  /** Bento of the remaining capabilities. */
  more: {
    eyebrow: string
    title: string
    lede: string
    items: { icon: string; title: string; d: string }[]
  }
  safe: {
    eyebrow: string
    title: string
    lede: string
    items: { icon: string; title: string; d: string }[]
  }
  start: {
    eyebrow: string
    title: string
    lede: string
    pick: string
    tryHint: string
  }
  footer: { tagline: string; docs: string; github: string; pypi: string; licence: string }
}

export const strings: Record<Lang, Strings> = {
  en: {
    htmlLang: 'en',
    meta: {
      title: 'shirube — read your database as a map',
      description:
        'shirube turns a PostgreSQL or SQLite database into an interactive ER map you can read. Ask in plain language; the AI navigator answers on the map. Local-first, read-only, open source.',
    },
    nav: {
      docs: 'Documentation',
      github: 'GitHub',
      getStarted: 'Get started',
    },
    hero: {
      badge: 'Beta',
      badgeOss: 'Open source',
      title: 'Read your database as a map.',
      lede: 'A plain list of tables hides the one thing you need — how they connect. shirube opens your schema as a map you can explore, and ask in plain language.',
      ctaPrimary: 'Try it now',
      ctaSecondary: 'Read the documentation',
      installNote: 'Runs on your machine. No sign-up, nothing leaves your computer.',
    },
    demo: {
      badge: 'Live · sample database',
      title: 'This is the real shirube. Have a go.',
      note: 'The actual app, on a sample database — click any table to jump to it.',
      openTab: 'Open the demo in a new tab',
      loading: 'Loading the demo…',
    },
    ai: {
      eyebrow: 'AI navigator',
      title: 'Ask in plain language. The answer’s on the map.',
      desc: 'The tables involved light up, and every table name in the reply is a link you can jump to. Use your own Claude or OpenAI key, or a local model; it never writes SQL.',
      examples: [
        'How is a customer linked to the tracks they bought?',
        'Where does a customer’s email come from?',
        'Which tables make up an invoice?',
      ],
      examplesLabel: 'Example questions',
      note: 'Optional, and private: your question goes straight to the model you chose, never through a shirube server.',
    },
    explore: {
      eyebrow: 'The explorer',
      title: 'Follow the connections, one hop at a time.',
      desc: 'shirube opens on the most-connected table and shows just its immediate neighbours, not every table at once. Click a related table to move the map there and keep following the connections — so even a schema you’ve never seen is easy to find your way around.',
    },
    route: {
      eyebrow: 'Trace a route',
      title: 'The shortest path between any two tables.',
      desc: 'Pick any two tables and shirube traces the shortest path between them — a box for each table on the way, each connector labelled with the columns they join on. Click any box to jump there and walk the whole path on the map, one table at a time.',
    },
    draw: {
      eyebrow: 'Draw your own links',
      title: 'No foreign key? Draw the relationship yourself.',
      desc: 'Common in ORM-shaped, legacy or warehouse schemas: two tables are related but the database never declares it, so no edge is drawn. Connect them column to column and shirube adds a dotted edge you can travel — tagged in the detail card, saved per connection, and never written to your database.',
    },
    more: {
      eyebrow: 'More features',
      title: 'Everything else shirube does.',
      lede: 'The practical tools that round out shirube.',
      items: [
        {
          icon: 'search',
          title: 'Instant search',
          d: 'Press ⌘K / Ctrl K to jump straight to any table or column.',
        },
        {
          icon: 'tree',
          title: 'Schema tree',
          d: 'Browse the whole database as a collapsible tree, and jump to anything in it.',
        },
        {
          icon: 'table',
          title: 'Table detail',
          d: 'Columns, types and keys — plus what the table references, and what references it.',
        },
        {
          icon: 'preview',
          title: 'Data preview',
          d: 'Read a table’s actual rows in a drawer, with click-to-sort columns, simple filters and paging.',
        },
        {
          icon: 'link',
          title: 'Draw your own links',
          d: 'No foreign key? Connect two columns and follow the relationship — never written to your database.',
        },
        {
          icon: 'save',
          title: 'Saved connections',
          d: 'Manage several PostgreSQL or SQLite profiles; passwords live in your OS keychain, never a config file.',
        },
      ],
    },
    safe: {
      eyebrow: 'Safe by design',
      title: 'Look, but never touch.',
      lede: 'shirube only reads your database — there’s no query editor, and it never writes.',
      items: [
        {
          icon: 'lock',
          title: 'Read-only',
          d: 'Every connection is opened read-only with a statement timeout. No writes, no schema changes, ever.',
        },
        {
          icon: 'home',
          title: 'Local-first',
          d: 'It runs entirely on your machine and is never exposed to the network. Credentials live in your OS keychain and never leave your computer.',
        },
        {
          icon: 'shield',
          title: 'Your data, your AI',
          d: 'The AI navigator talks straight from your machine to the model you chose — with a local model, nothing leaves at all.',
        },
      ],
    },
    start: {
      eyebrow: 'Getting started',
      title: 'One command, no install',
      lede: 'shirube comes with a sample database, so you can start exploring right away — no database of your own needed.',
      pick: 'Run it with whichever you already have:',
      tryHint: 'Then open the bundled Sample database (Chinook), or connect your own PostgreSQL or SQLite.',
    },
    footer: {
      tagline: 'Read your database as a map.',
      docs: 'Documentation',
      github: 'GitHub',
      pypi: 'PyPI',
      licence: 'AGPL-3.0',
    },
  },

  ja: {
    htmlLang: 'ja',
    meta: {
      title: 'shirube — データベースが、見えてくる。',
      description:
        'shirube は PostgreSQL や SQLite のデータベースを、読める ER 図に変えます。ふだんの言葉で聞けば、AI ナビゲーターが図の上で答える。ローカル完結・読み取り専用・オープンソース。',
    },
    nav: {
      docs: 'ドキュメント',
      github: 'GitHub',
      getStarted: '使ってみる',
    },
    hero: {
      badge: 'beta',
      badgeOss: 'オープンソース',
      title: 'データベースが、見えてくる。',
      lede: 'テーブルの一覧では、どのテーブルとどのテーブルが繋がっているのかまでは分かりません。shirube はデータベースを ER 図で見せます。関係がひと目で掴め、気になることはそのまま質問できます。',
      ctaPrimary: '今すぐ試す',
      ctaSecondary: 'ドキュメントを見る',
      installNote: 'あなたのマシンで動きます。登録不要、データは外に出ません。',
    },
    demo: {
      badge: 'ライブ · サンプルDB',
      title: 'これは本物の shirube です。触ってみてください。',
      note: 'サンプルDBで動くデモ画面です。テーブルをクリックすると、そのテーブルへ移動します。',
      openTab: 'デモを新しいタブで開く',
      loading: 'デモを読み込んでいます…',
    },
    ai: {
      eyebrow: 'AI ナビゲーター',
      title: '一緒に、ER 図で答えを見つける。',
      desc: '質問すると、関連するテーブルが ER 図上でハイライトされます。回答の中のテーブル名はすべてリンクになっていて、押すとそのテーブルへ移動できます。Claude や OpenAI の API キー、もしくはローカルモデルを使用します。',
      examples: [
        '顧客が買った曲は、どうやって調べる？',
        '顧客のメールアドレスは、どのテーブルにある？',
        '請求は、どのテーブルからできている？',
      ],
      examplesLabel: '質問の例',
      note: '使うかどうかは自由です。質問は選んだモデルへ直接送られ、shirube のサーバーを通ることはありません。',
    },
    explore: {
      eyebrow: '動く ER 図',
      title: '隣のテーブルへ、一歩ずつ。',
      desc: 'shirube は、いちばん多くのテーブルと繋がっているテーブルから始めます。画面に出るのは、そのすぐ隣のテーブルだけ。何百ものテーブルが一度に並ぶことはありません。関連するテーブルをクリックすると、そのテーブルを中心に表示が切り替わります。こうして隣へ隣へと見ていけるので、初めてのデータベースでも迷いません。',
    },
    route: {
      eyebrow: '経路を調べる',
      title: '2つのテーブルを結ぶ、最短経路。',
      desc: '2つのテーブルを選ぶと、shirube がそれらをつなぐ最短の経路を見つけます。経路上のテーブルが順番に並び、どのカラムでつながっているかも一つずつ示されます。各テーブルを押すと ER 図でそこへ移動するので、始点から終点まで順に見ていけます。',
    },
    draw: {
      eyebrow: '関連を自分で描く',
      title: '外部キーがない？ 関連は自分で描ける。',
      desc: 'ORM 由来・レガシー・DWH のスキーマでよくある「関連はあるのに DB が宣言していない」ケース。カラム同士を繋ぐと、shirube が辿れる点線エッジを引きます。詳細カードに印がつき、接続ごとに保存され、DB には一切書き込みません。',
    },
    more: {
      eyebrow: 'その他の機能',
      title: 'ほかにも、できること。',
      lede: '日々の作業を支える、実用的な機能。',
      items: [
        {
          icon: 'search',
          title: '瞬時の検索',
          d: '⌘K / Ctrl K で検索を開き、目的のテーブルや列にすぐ移動できます。',
        },
        {
          icon: 'tree',
          title: 'スキーマツリー',
          d: 'データベース全体をツリーで一覧でき、目的のテーブルへすぐ移動できます。',
        },
        {
          icon: 'table',
          title: 'テーブルの詳細',
          d: 'カラム・型・キーに加え、参照先と参照元もひと目で。',
        },
        {
          icon: 'preview',
          title: 'データプレビュー',
          d: 'テーブルの実際の行データをその場で確認できます。列で並べ替え、絞り込み、ページ送りにも対応。',
        },
        {
          icon: 'link',
          title: '関連を自分で描く',
          d: '外部キーがなくても、関連する2つのカラムを指定すれば、shirube が線でつなぎます。本物の外部キーと同じように移動でき、データベースには書き込みません。',
        },
        {
          icon: 'save',
          title: '保存できる接続',
          d: 'PostgreSQL / SQLite のプロファイルを複数管理。パスワードは OS のキーチェーンに入り、設定ファイルには残りません。',
        },
      ],
    },
    safe: {
      eyebrow: '設計された安全性',
      title: '読むだけ。書き換えはしない。',
      lede: 'shirube はデータベースを読むための道具です。クエリエディタはなく、書き込みも一切ありません。',
      items: [
        {
          icon: 'lock',
          title: '読み取り専用',
          d: '接続はすべて読み取り専用で開き、書き込みもスキーマ変更もできません。時間のかかりすぎるクエリは自動で止まるので、データベースに負担をかけません。',
        },
        {
          icon: 'home',
          title: 'ローカル完結',
          d: 'あなたのマシンだけで動き、ネットワークには公開されません。認証情報は OS のキーチェーンに入り、外へ出ません。',
        },
        {
          icon: 'shield',
          title: 'あなたのデータは、選んだ AI にだけ。',
          d: 'AI ナビゲーターは、あなたのマシンから、選んだモデルと直接やり取りします。ローカルモデルなら、何一つ外に出ません。',
        },
      ],
    },
    start: {
      eyebrow: 'クイックスタート',
      title: 'コマンド1つ、インストール不要',
      lede: '使いたいデータベースがお手元になくても、shirube にはサンプルDBが同梱されているので、すぐに試せます。',
      pick: 'お使いの実行環境を選んでください。',
      tryHint: 'あとは同梱の Sample database (Chinook) を開くか、お手元の PostgreSQL / SQLite に接続するだけ。',
    },
    footer: {
      tagline: 'データベースが、見えてくる。',
      docs: 'ドキュメント',
      github: 'GitHub',
      pypi: 'PyPI',
      licence: 'AGPL-3.0',
    },
  },
}
