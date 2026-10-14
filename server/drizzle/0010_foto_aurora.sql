-- Foto do Edifício Aurora (condomínio da demo), em public/stations/edificio-aurora.webp.
-- Só preenche se ainda estiver vazia: não sobrescreve foto escolhida no admin.
UPDATE "station" SET "image_url" = '/stations/edificio-aurora.webp' WHERE "name" = 'Edifício Aurora' AND "image_url" IS NULL;
