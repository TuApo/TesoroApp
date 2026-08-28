import {  Component , ChangeDetectionStrategy } from '@angular/core';
import { NavbarComponent } from "../../components/navbar/navbar.component";
import { SidebarComponent } from "../../components/sidebar/sidebar.component";
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AiTutor } from "../../components/ai-tutor/ai-tutor";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dashboard',
  imports: [
    NavbarComponent,
    SidebarComponent,
    RouterOutlet,
    MatIconModule,
    AiTutor
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
} )
export class DashboardComponent {
  isSidebarHidden = false;

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

}
