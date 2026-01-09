export async function bunnyUpload({
  storageZone,
  storagePassword,
  region,
  remotePath,
  buffer,
  contentType
}) {
  const base =
    region === "global"
      ? "https://storage.bunnycdn.com"
      : `https://${region}.storage.bunnycdn.com`;

  const url = `${base}/${storageZone}/${remotePath}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: storagePassword,
      "Content-Type": contentType
    },
    body: buffer
  });

  if (!res.ok) {
    throw new Error("Bunny upload failed");
  }
}

export function bunnyPublicUrl(pullZone, path) {
  return `${pullZone.replace(/\/$/, "")}/${path}`;
}

export async function bunnyExists(pullZone, path) {
  const res = await fetch(
    `${pullZone.replace(/\/$/, "")}/${path}`,
    { method: "HEAD" }
  );
  return res.ok;
}
