'use strict';

/** `public.institutions` — 04-data-model.md §5.2.1. Domain: Institution. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Institution',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(50), allowNull: false },
      code: { type: DataTypes.STRING(25), allowNull: false },
      address: { type: DataTypes.TEXT, allowNull: false },
      /**
       * The shape this institution's inventory codes are generated in — Phase
       * 25 (`CR-006`), REQ-ORG-007.
       *
       * NULL means NOT CONFIGURED, not "empty": such an institution receives
       * the application default (`domain/inventoryCodeFormat.js formatFor`).
       * The two are kept distinct so a later change to the default can reach
       * institutions that never chose one.
       */
      inventoryCodeFormat: { type: DataTypes.STRING(200), allowNull: true },
      /**
       * The Teacher Storage Room — migration 063, REQ-REQUEST-023: one Location
       * of THIS institution (composite key), the default intended location for
       * a teacher who is no Location PIC. NULL means not configured. A default
       * only: it moves no unit and is never copied into a request.
       */
      teacherStorageLocationId: { type: DataTypes.UUID, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { schema: 'public', tableName: 'institutions' }
  );
