CREATE TABLE [User] ([UserId] decimal( 16) NOT NULL IDENTITY(1,1), [UserName] nvarchar(64) NOT NULL , [UserLastName] nvarchar(64) NOT NULL , [UserEmail] nvarchar(100) NOT NULL , [UserEmailValidated] BIT NOT NULL , [UserDOB] datetime NOT NULL , PRIMARY KEY([UserId]));

CREATE TABLE [Ticket] ([TicketId] uniqueidentifier NOT NULL ROWGUIDCOL , [TicketCode] nvarchar(32) NOT NULL , [EventId] decimal( 16) NOT NULL , [TicketCreationTimestamp] datetime2(3) NOT NULL , [TicketActive] BIT NOT NULL , [UserId] decimal( 16) NOT NULL , [TicketWinner] BIT NOT NULL , [TicketVoucher] VARBINARY(MAX) NULL , [TicketVoucher_GXI] varchar(2048) NULL , PRIMARY KEY([TicketId]));
CREATE NONCLUSTERED INDEX [ITICKET1] ON [Ticket] ([EventId] );
CREATE NONCLUSTERED INDEX [ITICKET2] ON [Ticket] ([UserId] );

CREATE TABLE [Event] ([EventId] decimal( 16) NOT NULL IDENTITY(1,1), [EventName] nvarchar(64) NOT NULL , [EventStatus] nchar(2) NOT NULL , [EventDate] datetime NOT NULL , [EventTicketCloseDate] datetime NOT NULL , [EventTicketToRuffle] int NOT NULL , PRIMARY KEY([EventId]));

ALTER TABLE [Ticket] ADD CONSTRAINT [ITICKET1] FOREIGN KEY ([EventId]) REFERENCES [Event] ([EventId]);
ALTER TABLE [Ticket] ADD CONSTRAINT [ITICKET2] FOREIGN KEY ([UserId]) REFERENCES [User] ([UserId]);