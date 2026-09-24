import { BeforeInsert, CreateDateColumn, DeleteDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/**
 * Base de toda entidad: id UUID v7 (ordenable por tiempo), fechas de creación/actualización y borrado lógico.
 * No es el `BaseEntity` de TypeORM (Active Record): importa siempre este.
 */
export abstract class BaseEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @BeforeInsert()
  private assignId(): void {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
