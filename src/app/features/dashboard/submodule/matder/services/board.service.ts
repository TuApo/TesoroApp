import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import {
  BoardResponse, BoardListResponse, CardSummary, CardDetailResponse,
  ChecklistItemResponse, CardCommentResponse, LabelResponse, CardLabelResponse, UploadResponse,
} from '../models/board.models';

@Injectable({ providedIn: 'root' })
export class BoardService {
  private base = `${environment.apiUrl}/matder`;

  constructor(private http: HttpClient) {}

  private err(e: any) { return throwError(() => e); }

  // ── Boards ──
  listBoards(): Promise<BoardResponse[]> {
    return firstValueFrom(this.http.get<BoardResponse[]>(`${this.base}/boards/`).pipe(catchError(this.err)));
  }

  getBoard(id: number): Promise<BoardResponse> {
    return firstValueFrom(this.http.get<BoardResponse>(`${this.base}/boards/${id}/`).pipe(catchError(this.err)));
  }

  createBoard(data: { workspace: number; name: string; description?: string; accent?: string }): Promise<BoardResponse> {
    return firstValueFrom(this.http.post<BoardResponse>(`${this.base}/boards/`, data).pipe(catchError(this.err)));
  }

  updateBoard(id: number, data: Partial<BoardResponse>): Promise<BoardResponse> {
    return firstValueFrom(this.http.patch<BoardResponse>(`${this.base}/boards/${id}/`, data).pipe(catchError(this.err)));
  }

  deleteBoard(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/boards/${id}/`).pipe(catchError(this.err)));
  }

  getBoardLists(boardId: number): Promise<BoardListResponse[]> {
    return firstValueFrom(this.http.get<BoardListResponse[]>(`${this.base}/boards/${boardId}/lists/`).pipe(catchError(this.err)));
  }

  // ── Lists ──
  createList(data: { board: number; name: string; list_type?: string; position?: number }): Promise<BoardListResponse> {
    return firstValueFrom(this.http.post<BoardListResponse>(`${this.base}/boards/${data.board}/lists/`, data).pipe(catchError(this.err)));
  }

  updateList(id: number, data: Partial<BoardListResponse>): Promise<BoardListResponse> {
    return firstValueFrom(this.http.patch<BoardListResponse>(`${this.base}/lists/${id}/`, data).pipe(catchError(this.err)));
  }

  deleteList(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/lists/${id}/`).pipe(catchError(this.err)));
  }

  // ── Cards ──
  getCards(params?: { board_list?: number }): Promise<CardSummary[]> {
    if (!params?.board_list) {
       return firstValueFrom(this.http.get<CardSummary[]>(`${this.base}/cards/`).pipe(catchError(this.err)));
    }
    return firstValueFrom(this.http.get<CardSummary[]>(`${this.base}/lists/${params.board_list}/cards/`).pipe(catchError(this.err)));
  }

  getCardDetail(id: number): Promise<CardDetailResponse> {
    return firstValueFrom(this.http.get<CardDetailResponse>(`${this.base}/cards/${id}/detail/`).pipe(catchError(this.err)));
  }

  createCard(data: { board_list: number; title: string; description?: string; status?: string; priority?: string; due_at?: string | null; position?: number }): Promise<CardSummary> {
    return firstValueFrom(this.http.post<CardSummary>(`${this.base}/lists/${data.board_list}/cards/`, data).pipe(catchError(this.err)));
  }

  updateCard(id: number, data: Record<string, any>): Promise<CardSummary> {
    return firstValueFrom(this.http.patch<CardSummary>(`${this.base}/cards/${id}/`, data).pipe(catchError(this.err)));
  }

  deleteCard(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/cards/${id}/`).pipe(catchError(this.err)));
  }

  moveCard(id: number, targetListId: number, targetIndex: number): Promise<CardSummary> {
    return firstValueFrom(this.http.patch<CardSummary>(`${this.base}/cards/${id}/move/`, { new_list_id: targetListId, new_position: targetIndex }).pipe(catchError(this.err)));
  }

  getCalendarCards(): Promise<CardSummary[]> {
    return firstValueFrom(this.http.get<CardSummary[]>(`${this.base}/cards/assigned/calendar/`).pipe(catchError(this.err)));
  }

  // ── Comments ──
  createComment(cardId: number, body: string): Promise<CardCommentResponse> {
    return firstValueFrom(this.http.post<CardCommentResponse>(`${this.base}/cards/${cardId}/comments/`, { body }).pipe(catchError(this.err)));
  }

  deleteComment(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/comments/${id}/`).pipe(catchError(this.err)));
  }

  // ── Checklist ──
  createChecklistItem(cardId: number, content: string): Promise<ChecklistItemResponse> {
    return firstValueFrom(this.http.post<ChecklistItemResponse>(`${this.base}/cards/${cardId}/checklist-items/`, { content }).pipe(catchError(this.err)));
  }

  updateChecklistItem(id: number, data: { content?: string; completed?: boolean }): Promise<ChecklistItemResponse> {
    return firstValueFrom(this.http.patch<ChecklistItemResponse>(`${this.base}/checklist-items/${id}/`, data).pipe(catchError(this.err)));
  }

  deleteChecklistItem(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/checklist-items/${id}/`).pipe(catchError(this.err)));
  }

  // ── Labels ──
  getLabels(boardId: number): Promise<LabelResponse[]> {
    return firstValueFrom(this.http.get<LabelResponse[]>(`${this.base}/boards/${boardId}/labels/`).pipe(catchError(this.err)));
  }

  createLabel(boardId: number, data: { name: string; color: string }): Promise<LabelResponse> {
    return firstValueFrom(this.http.post<LabelResponse>(`${this.base}/boards/${boardId}/labels/`, data).pipe(catchError(this.err)));
  }

  addCardLabel(cardId: number, labelId: number): Promise<CardLabelResponse> {
    return firstValueFrom(this.http.post<CardLabelResponse>(`${this.base}/cards/${cardId}/labels/${labelId}/`, {}).pipe(catchError(this.err)));
  }

  removeCardLabel(cardId: number, labelId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/cards/${cardId}/labels/${labelId}/`).pipe(catchError(this.err)));
  }

  // ── Uploads ──
  uploadFile(cardId: number, file: File): Promise<UploadResponse> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('card', String(cardId));
    return firstValueFrom(this.http.post<UploadResponse>(`${this.base}/uploads/`, fd).pipe(catchError(this.err)));
  }

  deleteUpload(uuid: string): Promise<void> {
    // El backend expone DELETE /matder/uploads/<uuid>/ (matcher <uuid>),
    // así que debemos pasar el uuid del upload, no el id numérico.
    return firstValueFrom(this.http.delete<void>(`${this.base}/uploads/${uuid}/`).pipe(catchError(this.err)));
  }

  /**
   * Descarga el binario de un adjunto vía HttpClient (responseType blob) para que el
   * AuthInterceptor agregue el header Authorization. Un <a href> directo no llevaría el
   * token y el gateway lo rechazaría. El backend responde con Content-Disposition: attachment.
   */
  downloadUpload(uuid: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.base}/uploads/${uuid}/file/`, { responseType: 'blob' }).pipe(catchError(this.err))
    );
  }
}
