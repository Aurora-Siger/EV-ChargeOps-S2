-- Nova foto da FIAP Aclimação (public/stations/fiap-aclimacao.webp; o .jpg antigo saiu do app).
-- Troca só se estiver vazia ou ainda com a foto padrão antiga: não sobrescreve foto escolhida no admin.
UPDATE "station" SET "image_url" = '/stations/fiap-aclimacao.webp'
WHERE "name" = 'FIAP Aclimação' AND ("image_url" IS NULL OR "image_url" = '/stations/fiap-aclimacao.jpg');
