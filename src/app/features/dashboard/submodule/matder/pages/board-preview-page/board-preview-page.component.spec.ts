import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { BoardPreviewPageComponent } from './board-preview-page.component';

describe('BoardPreviewPageComponent', () => {
  let component: BoardPreviewPageComponent;
  let fixture: ComponentFixture<BoardPreviewPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardPreviewPageComponent, HttpClientTestingModule, RouterTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardPreviewPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in loading state', () => {
    expect(component.loading()).toBe(true);
  });

  it('should have null board initially', () => {
    expect(component.board()).toBeNull();
  });

  it('should have empty lists initially', () => {
    expect(component.lists()).toEqual([]);
  });

  it('getListIds() should return list id strings', () => {
    component.lists.set([
      { id: 1, uuid: '', board: 1, name: 'Todo', list_type: 'TODO', position: 0, cards: [], created_at: '', updated_at: '' },
      { id: 2, uuid: '', board: 1, name: 'Done', list_type: 'DONE', position: 1, cards: [], created_at: '', updated_at: '' },
    ]);
    expect(component.getListIds()).toEqual(['list-1', 'list-2']);
  });

  it('priorityLabel() should return correct labels', () => {
    expect(component.priorityLabel('LOW')).toBe('Baja');
    expect(component.priorityLabel('HIGH')).toBe('Alta');
    expect(component.priorityLabel('URGENT')).toBe('Urgente');
    expect(component.priorityLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  // startAddCard dejo de ser el "alta inline" que escribia addingToListId: hoy
  // abre el modal completo sobre la lista destino. Y resuelve el id contra
  // lists(), asi que sin listas cargadas sale sin hacer nada.
  it('startAddCard() abre el modal sobre la lista destino', () => {
    component.lists.set([
      { id: 5, uuid: '', board: 1, name: 'Todo', list_type: 'TODO', position: 0, cards: [], created_at: '', updated_at: '' },
    ]);

    component.startAddCard(5);

    expect(component.showCardModal).toBeTrue();
    expect(component.editingCardListId).toBe(5);
    expect(component.editingCardListName).toBe('Todo');
    expect(component.editingCardId).withContext('es alta, no edicion').toBeNull();
    expect(component.cardFormTitle).toBe('');
  });

  it('startAddCard() con un id que no esta en lists() no abre nada', () => {
    component.lists.set([]);
    component.startAddCard(5);
    expect(component.showCardModal).toBeFalse();
  });

  it('cancelAddCard() should reset addingToListId', () => {
    component.addingToListId = 5;
    component.cancelAddCard();
    expect(component.addingToListId).toBeNull();
  });
});
