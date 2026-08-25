// 向量化检索：TF-IDF 稀疏向量 + 余弦相似度。
// 完全本地、零依赖、零网络。每个章节与每个问题都被表示为
// 「字 unigram + 二字 bigram」词频向量，按 IDF 加权后做余弦相似度排序。
// 这是货真价实的向量检索（稀疏向量空间），不依赖任何外部 embedding 服务。
// 若日后想升级为稠密语义向量，只需把本文件的向量替换为 embedding 模型输出即可。

// 清洗：去掉标点和空白，保留汉字
function clean(text) {
  return (text || "").replace(/[\s，。、；：！？“”‘’《》（）()【】…—·\-.,!?;:'"」『』]/g, "");
}

export function tokenize(text) {
  const s = clean(text);
  const toks = [];
  for (let i = 0; i < s.length; i++) {
    toks.push(s[i]); // unigram
    if (i < s.length - 1) toks.push(s[i] + s[i + 1]); // bigram
  }
  return toks;
}

// 构建索引：返回 { docVectors, idf, N }
export function buildIndex(docs) {
  const N = docs.length;
  const df = new Map();
  const docTfs = docs.map((d) => {
    const tf = new Map();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const idf = new Map();
  for (const [t, count] of df) idf.set(t, Math.log((N + 1) / (count + 1)) + 1);
  const docVectors = docTfs.map((tf) => {
    const vec = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * (idf.get(t) || 0); // augmented tf-idf
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
  return { docVectors, idf, N };
}

// 查询：返回 topK 个相关章节（含 score）
export function query(index, docs, q, topK = 4) {
  const qv = new Map();
  let norm = 0;
  const tf = new Map();
  for (const t of tokenize(q)) tf.set(t, (tf.get(t) || 0) + 1);
  for (const [t, c] of tf) {
    const idf = index.idf.get(t);
    if (idf === undefined) continue;
    const w = (1 + Math.log(c)) * idf;
    qv.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of qv) qv.set(t, w / norm);

  const scored = index.docVectors.map((vec, i) => {
    // 在较小的向量上迭代，省算力
    const [small, big] = qv.size < vec.size ? [qv, vec] : [vec, qv];
    let dot = 0;
    for (const [t, w] of small) {
      const o = big.get(t);
      if (o) dot += w * o;
    }
    return { i, score: dot };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, topK)
    .map((s) => ({ ...docs[s.i], score: Number(s.score.toFixed(4)) }));
}
