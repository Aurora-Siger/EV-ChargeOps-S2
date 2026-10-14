-- Fotos das unidades FIAP (arquivos em public/stations/, servidos pelo próprio app).
-- Só preenche onde o gestor ainda não cadastrou uma foto: não sobrescreve escolha feita no admin.
UPDATE "station" SET "image_url" = '/stations/fiap-paulista.jpg' WHERE "name" = 'FIAP Paulista' AND "image_url" IS NULL;--> statement-breakpoint
UPDATE "station" SET "image_url" = '/stations/fiap-aclimacao.jpg' WHERE "name" = 'FIAP Aclimação' AND "image_url" IS NULL;
