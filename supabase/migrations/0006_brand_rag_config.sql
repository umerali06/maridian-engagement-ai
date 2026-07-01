alter table brands
  add column if not exists rag_threshold real default 0.45,
  add column if not exists rag_top_k int default 5;
