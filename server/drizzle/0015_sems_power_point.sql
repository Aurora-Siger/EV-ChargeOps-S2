CREATE TABLE "sems_power_point" (
	"sn" text NOT NULL,
	"at" timestamp NOT NULL,
	"kw" double precision NOT NULL,
	CONSTRAINT "sems_power_point_sn_at_pk" PRIMARY KEY("sn","at")
);
